import { SettingsStore } from '@openminutes/core';
import { settings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GoogleSessionDto } from '../dto.js';
import { googleSessionRoutes } from './google-session.js';

const state = (expires: number) =>
  JSON.stringify({
    cookies: [
      { name: 'SID', value: 'cookie-secret-value', domain: '.google.com', path: '/', expires },
    ],
    origins: [],
  });
const inDays = (days: number) => Date.now() / 1000 + days * 86_400;

describe('Google session API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;
  let app: Hono;

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
    app = new Hono().route('/', googleSessionRoutes({ settings: store }));
  });
  afterAll(() => test.close());

  const send = (method: string, body?: string) =>
    app.request('/bot/google-session', {
      method,
      ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body }),
    });

  it('starts without a session', async () => {
    expect(await (await send('GET')).json()).toEqual({
      status: 'missing',
      expiresAt: null,
      credentials: null,
      keepAlive: null,
      needsAttention: false,
      notify: true,
    });
  });

  it('imports a storage state, reports it valid and never returns the cookies', async () => {
    const response = await send('PUT', state(inDays(30)));
    const dto = (await response.json()) as GoogleSessionDto;
    expect(dto.status).toBe('valid');
    expect(dto.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(dto)).not.toContain('cookie-secret-value');
    const [row] = await test.db.select().from(settings);
    expect(row?.value).not.toContain('cookie-secret-value');
  });

  it('stores sign-in details encrypted and never returns them', async () => {
    const response = await app.request('/bot/google-credentials', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bot@example.com', password: 'hunter2-secret' }),
    });
    const dto = (await response.json()) as GoogleSessionDto;
    expect(dto.credentials).toEqual({
      email: 'bot@example.com',
      hasPassword: true,
      hasTotp: false,
    });
    expect(JSON.stringify(dto)).not.toContain('hunter2-secret');
    const rows = await test.db.select().from(settings);
    expect(JSON.stringify(rows)).not.toContain('hunter2-secret');
    const bad = await app.request('/bot/google-credentials', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'other@example.com' }),
    });
    expect(bad.status).toBe(400);
    const removed = await app.request('/bot/google-credentials', { method: 'DELETE' });
    expect(((await removed.json()) as GoogleSessionDto).credentials).toBeNull();
  });

  it('toggles expiry notifications', async () => {
    const off = await app.request('/bot/google-notifications', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notify: false }),
    });
    expect(((await off.json()) as GoogleSessionDto).notify).toBe(false);
  });

  it('reports a session whose cookies ran out as expired', async () => {
    const dto = (await (await send('PUT', state(inDays(-1)))).json()) as GoogleSessionDto;
    expect(dto.status).toBe('expired');
  });

  it('rejects files that are not a Google storage state', async () => {
    expect((await send('PUT', 'nope')).status).toBe(400);
    expect((await send('PUT', '{"cookies":[],"origins":[]}')).status).toBe(400);
    expect((await send('PUT', 'x'.repeat(1024 * 1024 + 1))).status).toBe(413);
  });

  it('removes the session', async () => {
    const dto = (await (await send('DELETE')).json()) as GoogleSessionDto;
    expect(dto).toMatchObject({ status: 'missing', expiresAt: null });
  });
});
