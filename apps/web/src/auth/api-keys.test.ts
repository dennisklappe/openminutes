import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { apiKeys, eq } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { hashApiKey } from './api-keys.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('API keys', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let cookie: string;

  const bearer = (key: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${key}`,
    ...extra,
  });
  const create = async (body: Record<string, unknown> = {}) => {
    const response = await app.request('/api/settings/api-keys', {
      method: 'POST',
      headers: { ...json, cookie },
      body: JSON.stringify({ name: 'Test key', scope: 'full', expiresInDays: null, ...body }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { key: { id: string; prefix: string }; secret: string };
  };
  const build = async (apiRateLimit?: number) => {
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-keys-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      ...(apiRateLimit && { apiRateLimit }),
    });
  };

  beforeAll(async () => {
    test = await createTestDatabase();
    await build();
    const setup = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  });
  afterAll(() => test.close());
  beforeEach(async () => {
    await test.db.delete(apiKeys);
    await build();
  });

  it('shows the secret once and stores only its hash', async () => {
    const created = await create({ name: 'Zapier' });
    expect(created.secret).toMatch(/^omk_[A-Za-z0-9_-]{43}$/);
    expect(created.secret.startsWith(created.key.prefix)).toBe(true);
    const [row] = await test.db.select().from(apiKeys);
    expect(row?.keyHash).toBe(hashApiKey(created.secret));
    expect(JSON.stringify(row)).not.toContain(created.secret);

    const list = await app.request('/api/settings/api-keys', { headers: { cookie } });
    const body = await list.text();
    expect(body).not.toContain(created.secret);
    expect(body).not.toContain('keyHash');
    expect(JSON.parse(body)).toHaveLength(1);
  });

  it('validates the key input', async () => {
    for (const body of [
      { name: '', scope: 'full', expiresInDays: null },
      { name: 'x', scope: 'admin', expiresInDays: null },
      { name: 'x', scope: 'full', expiresInDays: 7 },
    ]) {
      const response = await app.request('/api/settings/api-keys', {
        method: 'POST',
        headers: { ...json, cookie },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });

  it('serves a GET and a POST route with a bearer key and no cookie', async () => {
    const { secret: key } = await create();
    const get = await app.request('/api/settings/timezone', { headers: bearer(key) });
    expect(get.status).toBe(200);
    const post = await app.request('/api/meetings/bulk', {
      method: 'POST',
      headers: bearer(key, json),
      body: JSON.stringify({ action: 'archive', ids: [] }),
    });
    expect(post.status).not.toBe(401);
    expect(post.status).not.toBe(403);
  });

  it('skips the cookie origin check for a bearer request', async () => {
    const { secret: key } = await create();
    const response = await app.request('/api/settings/timezone', {
      method: 'PUT',
      headers: bearer(key, { 'content-type': 'text/plain', origin: 'https://evil.example' }),
      body: '{}',
    });
    expect(response.status).not.toBe(403);
    const cookieOnly = await app.request('/api/settings/timezone', {
      method: 'PUT',
      headers: { 'content-type': 'text/plain', origin: 'https://evil.example', cookie },
      body: '{}',
    });
    expect(cookieOnly.status).toBe(403);
  });

  it('lets a read key GET and HEAD but not write', async () => {
    const { secret: key } = await create({ scope: 'read' });
    expect((await app.request('/api/meetings', { headers: bearer(key) })).status).toBe(200);
    expect(
      (await app.request('/api/meetings', { method: 'HEAD', headers: bearer(key) })).status,
    ).toBe(200);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await app.request('/api/meetings/bulk', {
        method,
        headers: bearer(key, json),
        body: method === 'DELETE' ? null : '{}',
      });
      expect(response.status).toBe(403);
    }
  });

  it('keeps key management, accounts and auth away from every key', async () => {
    const full = await create();
    const read = await create({ scope: 'read' });
    const blocked: [string, string][] = [
      ['GET', '/api/settings/api-keys'],
      ['POST', '/api/settings/api-keys'],
      ['DELETE', `/api/settings/api-keys/${full.key.id}`],
      ['GET', '/api/accounts'],
      ['POST', '/api/oauth/google/start'],
      ['POST', '/api/setup'],
      ['POST', '/api/login'],
      ['POST', '/api/logout'],
    ];
    for (const { secret: key } of [full, read]) {
      for (const [method, path] of blocked) {
        const response = await app.request(path, {
          method,
          headers: bearer(key, json),
          ...(method !== 'GET' && { body: '{}' }),
        });
        expect([method, path, response.status]).toEqual([method, path, 403]);
      }
    }
    const list = await app.request('/api/settings/api-keys', { headers: { cookie } });
    expect(await list.json()).toHaveLength(2);
  });

  it('answers 401 the same for unknown, revoked and expired keys', async () => {
    const revoked = await create();
    const expired = await create();
    const gone = await app.request(`/api/settings/api-keys/${revoked.key.id}`, {
      method: 'DELETE',
      headers: { ...json, cookie },
    });
    expect(gone.status).toBe(200);
    await test.db
      .update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiKeys.id, expired.key.id));
    const bodies = new Set<string>();
    for (const key of [revoked.secret, expired.secret, `omk_${'A'.repeat(43)}`]) {
      const response = await app.request('/api/meetings', { headers: bearer(key) });
      expect(response.status).toBe(401);
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1);
  });

  it('ignores the cookie when a bearer is present', async () => {
    const response = await app.request('/api/meetings', {
      headers: bearer(`omk_${'B'.repeat(43)}`, { cookie }),
    });
    expect(response.status).toBe(401);
    const { secret: key } = await create({ scope: 'read' });
    const write = await app.request('/api/meetings/bulk', {
      method: 'POST',
      headers: bearer(key, { ...json, cookie }),
      body: JSON.stringify({ action: 'archive', ids: [] }),
    });
    expect(write.status).toBe(403);
  });

  it('rate limits per key with Retry-After', async () => {
    await build(3);
    const a = await create();
    const b = await create();
    for (let i = 0; i < 3; i++) {
      expect((await app.request('/api/meetings', { headers: bearer(a.secret) })).status).toBe(200);
    }
    const limited = await app.request('/api/meetings', { headers: bearer(a.secret) });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await app.request('/api/meetings', { headers: bearer(b.secret) })).status).toBe(200);
  });

  it('writes last used at most once a minute', async () => {
    const { secret: key, key: made } = await create();
    const lastUsed = async () =>
      (await test.db.select().from(apiKeys).where(eq(apiKeys.id, made.id)))[0]?.lastUsedAt;
    expect(await lastUsed()).toBeNull();
    await app.request('/api/meetings', { headers: bearer(key) });
    const first = await lastUsed();
    expect(first).toBeInstanceOf(Date);
    await app.request('/api/meetings', { headers: bearer(key) });
    expect((await lastUsed())?.getTime()).toBe(first?.getTime());
    const old = new Date(Date.now() - 61_000);
    await test.db.update(apiKeys).set({ lastUsedAt: old }).where(eq(apiKeys.id, made.id));
    await app.request('/api/meetings', { headers: bearer(key) });
    expect((await lastUsed())?.getTime()).toBeGreaterThan(old.getTime());
  });
});
