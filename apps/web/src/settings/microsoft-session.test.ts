import { loadBotSessionInfo, SettingsStore } from '@openminutes/core';
import { settings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MicrosoftSessionDto } from '../dto.js';
import { googleSessionRoutes } from './google-session.js';
import { microsoftSessionRoutes } from './microsoft-session.js';

const inDays = (days: number) => Date.now() / 1000 + days * 86_400;
const state = (name: string, domain: string, expires: number) =>
  JSON.stringify({
    cookies: [{ name, value: 'cookie-secret-value', domain, path: '/', expires }],
    origins: [
      {
        origin: 'https://teams.microsoft.com',
        localStorage: [{ name: 'msal.token', value: 'token-secret-value' }],
      },
    ],
  });
const microsoft = (expires = inDays(30)) =>
  state('ESTSAUTHPERSISTENT', '.login.microsoftonline.com', expires);

describe('Microsoft session API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;
  let app: Hono;

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
    app = new Hono()
      .route('/', googleSessionRoutes({ settings: store }))
      .route('/', microsoftSessionRoutes({ settings: store }));
  });
  afterAll(() => test.close());

  const send = (method: string, body?: string) =>
    app.request('/bot/microsoft-session', {
      method,
      ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body }),
    });

  it('starts without a session', async () => {
    expect(await (await send('GET')).json()).toEqual({ status: 'missing', expiresAt: null });
  });

  it('imports a storage state, reports it valid and stores it encrypted', async () => {
    const dto = (await (await send('PUT', microsoft())).json()) as MicrosoftSessionDto;
    expect(dto.status).toBe('valid');
    expect(dto.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(dto)).not.toContain('cookie-secret-value');
    const rows = await test.db.select().from(settings);
    expect(JSON.stringify(rows)).not.toContain('cookie-secret-value');
    expect(JSON.stringify(rows)).not.toContain('token-secret-value');
  });

  it('leaves the Google session alone', async () => {
    expect((await loadBotSessionInfo('google', store)).status).toBe('missing');
    const google = await app.request('/bot/google-session');
    expect(((await google.json()) as { status: string }).status).toBe('missing');
  });

  it('accepts a session with only the browser session cookie', async () => {
    const dto = (await (await send('PUT', microsoft(-1))).json()) as MicrosoftSessionDto;
    expect(dto).toEqual({ status: 'valid', expiresAt: null });
  });

  it('reports a session whose cookies ran out as expired', async () => {
    const dto = (await (await send('PUT', microsoft(inDays(-1)))).json()) as MicrosoftSessionDto;
    expect(dto.status).toBe('expired');
  });

  it('rejects files that are not a Microsoft storage state', async () => {
    expect((await send('PUT', 'nope')).status).toBe(400);
    const google = await send('PUT', state('SID', '.google.com', inDays(30)));
    expect(google.status).toBe(400);
    expect(((await google.json()) as { error: string }).error).toContain('Microsoft');
    expect((await send('PUT', 'x'.repeat(1024 * 1024 + 1))).status).toBe(413);
  });

  it('removes the session', async () => {
    const dto = (await (await send('DELETE')).json()) as MicrosoftSessionDto;
    expect(dto).toEqual({ status: 'missing', expiresAt: null });
  });
});
