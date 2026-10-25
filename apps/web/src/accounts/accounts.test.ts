import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { startFakeCalendar, type FakeCalendar } from '@openminutes/calendar/fake';
import { LocalStorage, SettingsStore, type JobName, type JobPayloads } from '@openminutes/core';
import { calendars } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { AccountsDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('calendar account routes', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let fake: FakeCalendar;
  let app: Hono;
  let session = '';
  const sent: { name: JobName; payload: JobPayloads[JobName] }[] = [];

  beforeAll(async () => {
    test = await createTestDatabase();
    fake = await startFakeCalendar();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-web-'))),
      secret,
      calendarProviders: createProviders({ fakeBaseUrl: fake.baseUrl }),
      publicUrl: 'https://openminutes.test',
      version: '1.2.3',
      queue: {
        send: (name, payload) => {
          sent.push({ name, payload });
          return Promise.resolve();
        },
      },
    });
    const created = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    session = created.headers.get('set-cookie')?.split(';')[0] ?? '';
  });

  afterAll(async () => {
    await fake.close();
    await test.close();
  });

  const request = (path: string, init: RequestInit = {}, cookie = session) =>
    app.request(path, { ...init, headers: { ...json, cookie } });
  const send = (method: string, path: string, body?: unknown) =>
    request(path, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const accounts = async () => (await (await request('/api/accounts')).json()) as AccountsDto;

  async function connect(): Promise<Response> {
    const start = await request('/api/oauth/google/start');
    const oauthCookie = start.headers.get('set-cookie')?.split(';')[0] ?? '';
    const consent = await fetch(start.headers.get('location') ?? '', { redirect: 'manual' });
    const callback = new URL(consent.headers.get('location') ?? '');
    return app.request(`/api/oauth/google/callback${callback.search}`, {
      headers: { cookie: oauthCookie },
    });
  }

  it('requires a session', async () => {
    expect((await request('/api/accounts', {}, '')).status).toBe(401);
    expect((await request('/api/oauth/google/start', {}, '')).status).toBe(401);
  });

  it('shows the redirect URIs and stores provider credentials', async () => {
    const before = await accounts();
    expect(before.providers.google).toEqual({
      redirectUri: 'https://openminutes.test/api/oauth/google/callback',
      clientId: null,
      hasClientSecret: false,
    });
    expect(before.providers.microsoft).toMatchObject({
      redirectUri: 'https://openminutes.test/api/oauth/microsoft/callback',
      tenant: 'common',
    });

    expect((await send('PUT', '/api/accounts/providers/google', {})).status).toBe(400);
    expect((await send('PUT', '/api/accounts/providers/nope', { clientId: 'x' })).status).toBe(404);
    await send('PUT', '/api/accounts/providers/google', { clientId: 'cid', clientSecret: 'sec' });
    await send('PUT', '/api/accounts/providers/google', { clientId: 'cid-2' });
    expect((await accounts()).providers.google).toMatchObject({
      clientId: 'cid-2',
      hasClientSecret: true,
    });
  });

  it('refuses to connect without credentials', async () => {
    const response = await request('/api/oauth/microsoft/start');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('error=');
  });

  it('connects through PKCE and manages the account', async () => {
    const start = await request('/api/oauth/google/start');
    const authorize = new URL(start.headers.get('location') ?? '');
    expect(authorize.origin).toBe(fake.baseUrl);
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      'https://openminutes.test/api/oauth/google/callback',
    );
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(start.headers.get('set-cookie')).toMatch(/HttpOnly.*SameSite=Lax/i);

    const done = await connect();
    expect(done.headers.get('location')).toBe('/#/settings?connected=google');
    expect(sent.at(-1)?.name).toBe('calendar.sync');

    const [account] = (await accounts()).accounts;
    expect(account).toMatchObject({ provider: 'google', email: fake.store.email, calendars: [] });
    if (!account) throw new Error('account missing');

    await test.db.insert(calendars).values({
      accountId: account.id,
      externalId: 'primary',
      name: 'Primary',
      isPrimary: true,
    });
    const [calendar] = (await accounts()).accounts[0]?.calendars ?? [];
    expect(calendar?.joinRule).toBe('never');
    expect(
      (await send('PUT', `/api/accounts/calendars/${calendar?.id}`, { joinRule: 'x' })).status,
    ).toBe(400);
    expect(
      (await send('PUT', `/api/accounts/calendars/${calendar?.id}`, { joinRule: 'organizer' }))
        .status,
    ).toBe(200);
    expect((await accounts()).accounts[0]?.calendars[0]?.joinRule).toBe('organizer');
    expect(
      (await send('PUT', `/api/accounts/calendars/${account.id}`, { joinRule: 'all' })).status,
    ).toBe(404);

    sent.length = 0;
    expect((await send('POST', `/api/accounts/${account.id}/sync`)).status).toBe(200);
    expect(sent).toEqual([{ name: 'calendar.sync', payload: { accountId: account.id } }]);

    expect((await send('DELETE', `/api/accounts/${account.id}`)).status).toBe(200);
    expect((await accounts()).accounts).toEqual([]);
  });

  it('rejects callbacks without a matching state cookie', async () => {
    const start = await request('/api/oauth/google/start');
    const oauthCookie = start.headers.get('set-cookie')?.split(';')[0] ?? '';

    const noCookie = await app.request('/api/oauth/google/callback?code=c&state=s');
    expect(noCookie.headers.get('location')).toContain('error=');
    const wrongState = await app.request('/api/oauth/google/callback?code=c&state=forged', {
      headers: { cookie: oauthCookie },
    });
    expect(wrongState.headers.get('location')).toContain('error=');
    const wrongProvider = await app.request('/api/oauth/microsoft/callback?code=c&state=s', {
      headers: { cookie: oauthCookie },
    });
    expect(wrongProvider.headers.get('location')).toContain('error=');
  });

  it('reports a denied consent screen', async () => {
    const start = await request('/api/oauth/google/start');
    const oauthCookie = start.headers.get('set-cookie')?.split(';')[0] ?? '';
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');
    const denied = await app.request(
      `/api/oauth/google/callback?error=access_denied&error_description=Nope&state=${state}`,
      { headers: { cookie: oauthCookie } },
    );
    expect(denied.headers.get('location')).toBe('/#/settings?error=Nope');
  });
});
