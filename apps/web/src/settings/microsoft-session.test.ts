import { loadBotCredentials, loadBotSessionInfo, SettingsStore } from '@openminutes/core';
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
    expect(await (await send('GET')).json()).toEqual({
      status: 'missing',
      expiresAt: null,
      keepAlive: null,
      notify: true,
      credentials: null,
    });
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
    expect(dto).toMatchObject({ status: 'valid', expiresAt: null });
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
    expect(dto).toMatchObject({ status: 'missing', expiresAt: null });
  });

  it('turns the Microsoft alert mail off without touching the Google one', async () => {
    const put = (body: string) =>
      app.request('/bot/microsoft-notifications', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
      });
    expect((await put('{"notify":"no"}')).status).toBe(400);
    const dto = (await (await put('{"notify":false}')).json()) as MicrosoftSessionDto;
    expect(dto.notify).toBe(false);
    const google = await app.request('/bot/google-session');
    expect(((await google.json()) as { notify: boolean }).notify).toBe(true);
  });

  const credentials = (method: string, body?: unknown) =>
    app.request('/bot/microsoft-credentials', {
      method,
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });

  it('saves the sign-in details encrypted and never returns them', async () => {
    const response = await credentials('PUT', {
      email: 'bot@example.com',
      password: 'password-secret-value',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });
    const dto = (await response.json()) as MicrosoftSessionDto;
    expect(dto.credentials).toEqual({ email: 'bot@example.com', hasPassword: true, hasTotp: true });
    expect(JSON.stringify(dto)).not.toContain('password-secret-value');
    const rows = await test.db.select().from(settings);
    expect(JSON.stringify(rows)).not.toContain('password-secret-value');
    expect(JSON.stringify(rows)).not.toContain('JBSWY3DPEHPK3PXP');
    expect(await loadBotCredentials('google', store)).toBeUndefined();
  });

  it('keeps the saved password when it is left blank', async () => {
    await credentials('PUT', { email: 'bot@example.com' });
    expect((await loadBotCredentials('microsoft', store))?.password).toBe('password-secret-value');
  });

  it('rejects an invalid authenticator secret and a missing password', async () => {
    const bad = await credentials('PUT', { email: 'bot@example.com', totpSecret: '1!' });
    expect(bad.status).toBe(400);
    expect((await credentials('PUT', { email: 'new@example.com' })).status).toBe(400);
  });

  it('removes the sign-in details', async () => {
    const dto = (await (await credentials('DELETE')).json()) as MicrosoftSessionDto;
    expect(dto.credentials).toBeNull();
  });
});
