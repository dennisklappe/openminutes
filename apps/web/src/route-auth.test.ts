import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const secret = 'a-long-enough-test-secret';
const UUID = '00000000-0000-4000-8000-000000000000';

/** Routes that are public on purpose. Everything else under /api must demand a session. */
const PUBLIC = new Set([
  'GET /api/version',
  'GET /api/session',
  'POST /api/setup',
  'POST /api/login',
  'POST /api/logout',
  'GET /api/oauth/callback',
  'GET /api/oauth/:provider/callback',
]);

describe('route authentication', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;

  beforeAll(async () => {
    test = await createTestDatabase();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-auth-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
    });
    // A password must exist, otherwise every route would fail for the wrong reason.
    await app.request('/api/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
  });
  afterAll(() => test.close());

  it('rejects every non-public API route without a session', async () => {
    const open: string[] = [];
    const seen = new Set<string>();
    for (const route of app.routes) {
      if (route.method === 'ALL' || !route.path.startsWith('/api/')) continue;
      const key = `${route.method} ${route.path}`;
      if (PUBLIC.has(key) || seen.has(key)) continue;
      seen.add(key);
      const path = route.path.replace(/:[A-Za-z]+/g, UUID).replace(/\*/g, 'x');
      const response = await app.request(path, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        ...(route.method !== 'GET' && route.method !== 'DELETE' && { body: '{}' }),
      });
      if (response.status !== 401) open.push(`${key} -> ${response.status}`);
    }
    expect(seen.size).toBeGreaterThan(80);
    expect(open).toEqual([]);
  });

  it('refuses a large body before it is read, even without a session', async () => {
    const big = JSON.stringify({ password: 'x'.repeat(5 * 1024 * 1024) });
    for (const path of ['/api/login', '/api/setup']) {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: big,
      });
      expect(response.status).toBe(413);
    }
  });

  it('lets a recording chunk be larger than the JSON limit', async () => {
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const headers = { 'content-type': 'application/json', cookie };
    await app.request('/api/settings/phone', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enabled: true, consentText: 'ok' }),
    });
    const id = '5c8d3a52-0000-4000-8000-0000000000aa';
    await app.request('/api/recordings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, mimeType: 'audio/webm', startedAt: '2026-10-22T14:05:09.000Z' }),
    });
    const chunk = await app.request(`/api/recordings/${id}/chunks/0`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', cookie },
      body: new Uint8Array(5 * 1024 * 1024),
    });
    expect(chunk.status).toBe(200);
  });
});
