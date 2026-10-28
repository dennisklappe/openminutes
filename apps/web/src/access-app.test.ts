import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { AccessVerifier } from './auth/access.js';
import { makeKey, signToken, startFakeJwks, type FakeJwks } from './auth/access-fixtures.js';
import type { SessionDto } from './dto.js';

describe('web API behind Cloudflare Access', () => {
  const key = makeKey('key-1');
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let jwks: FakeJwks;
  let app: Hono;

  beforeAll(async () => {
    test = await createTestDatabase();
    jwks = await startFakeJwks([key]);
    const secret = 'a-long-enough-test-secret';
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-access-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      access: new AccessVerifier(jwks.config),
    });
  });
  afterAll(async () => {
    await jwks.close();
    await test.close();
  });

  const asUser = (token = signToken(key)) => ({ 'cf-access-jwt-assertion': token });

  it('rejects requests without a valid token, even with a spoofed email header', async () => {
    const spoofed = { 'cf-access-authenticated-user-email': 'dana@example.com' };
    expect((await app.request('/api/meetings')).status).toBe(401);
    expect((await app.request('/api/meetings', { headers: spoofed })).status).toBe(401);
    expect((await app.request('/api/session', { headers: spoofed })).status).toBe(401);
    const home = await app.request('/', { headers: spoofed });
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toBe('https://github.com/dennisklappe/openminutes');
    const forged = signToken(makeKey('key-1'));
    expect((await app.request('/api/meetings', { headers: asUser(forged) })).status).toBe(401);
  });

  it('accepts the Access cookie as well as the header', async () => {
    const cookie = { cookie: `CF_Authorization=${signToken(key)}` };
    expect((await app.request('/api/session', { headers: cookie })).status).toBe(200);
    expect((await app.request('/', { headers: cookie })).status).not.toBe(302);
    const forged = { cookie: 'CF_Authorization=a.b.c' };
    expect((await app.request('/', { headers: forged })).status).toBe(302);
  });

  it('sends /login to the app root and only redirects GET /', async () => {
    const login = await app.request('/login');
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toBe('/');
    expect((await app.request('/other')).status).toBe(401);
  });

  it('takes an API key instead of an Access login, and nothing else without one', async () => {
    const bogus = { authorization: `Bearer omk_${'C'.repeat(43)}` };
    expect((await app.request('/api/meetings', { headers: bogus })).status).toBe(401);
    expect(
      (await app.request('/api/meetings', { headers: { authorization: 'Bearer x' } })).status,
    ).toBe(401);
    const created = await app.request('/api/settings/api-keys', {
      method: 'POST',
      headers: { ...asUser(), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Sync', scope: 'read', expiresInDays: null }),
    });
    const { secret } = (await created.json()) as { secret: string };
    const headers = { authorization: `Bearer ${secret}` };
    expect((await app.request('/api/meetings', { headers })).status).toBe(200);
    expect((await app.request('/api/settings/api-keys', { headers })).status).toBe(403);
  });

  it('keeps the version endpoint open', async () => {
    expect((await app.request('/api/version')).status).toBe(200);
  });

  it('lets the browser fetch the install manifest and icons without a login', async () => {
    for (const path of ['/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png']) {
      expect((await app.request(path)).status).not.toBe(401);
    }
  });

  it('signs in as the Access email without a password setup', async () => {
    const session = (await (
      await app.request('/api/session', { headers: asUser() })
    ).json()) as SessionDto;
    expect(session).toEqual({
      setupRequired: false,
      authenticated: true,
      email: 'dana@example.com',
    });
    expect((await app.request('/api/meetings', { headers: asUser() })).status).toBe(200);
  });

  it('has no password endpoints', async () => {
    for (const path of ['/api/setup', '/api/login']) {
      const response = await app.request(path, {
        method: 'POST',
        headers: { ...asUser(), 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'correct horse battery' }),
      });
      expect(response.status).toBe(404);
    }
  });

  it('keeps the cross-site request protection', async () => {
    const response = await app.request('/api/meetings', {
      method: 'POST',
      headers: {
        ...asUser(),
        origin: 'https://evil.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'url=https://meet.google.com/abc-defg-hij',
    });
    expect(response.status).toBe(403);
  });
});
