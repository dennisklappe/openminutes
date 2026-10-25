import { settings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clearGoogleSession,
  describeGoogleSession,
  InvalidGoogleSessionError,
  loadGoogleSession,
  loadGoogleSessionInfo,
  markGoogleSessionExpired,
  parseGoogleSession,
  refreshGoogleSession,
  saveGoogleSession,
} from './google-session.js';
import { SettingsStore } from './settings.js';

const NOW = new Date('2026-10-21T12:00:00Z');
const inDays = (days: number) => NOW.getTime() / 1000 + days * 86_400;

const cookie = (name: string, expires: number, domain = '.google.com') => ({
  name,
  value: 'secret-cookie-value',
  domain,
  path: '/',
  expires,
  httpOnly: true,
  secure: true,
  sameSite: 'None' as const,
});
const stateWith = (...cookies: ReturnType<typeof cookie>[]) => ({ cookies, origins: [] });

describe('parseGoogleSession', () => {
  it('accepts a storage state with a Google sign-in cookie', () => {
    const state = stateWith(cookie('SID', inDays(30)), cookie('NID', inDays(30)));
    expect(parseGoogleSession(JSON.stringify(state)).cookies).toHaveLength(2);
  });

  it.each([
    ['not JSON', 'nope'],
    ['no cookies array', '{"origins":[]}'],
    ['a cookie without a domain', '{"cookies":[{"name":"SID"}],"origins":[]}'],
    ['no Google sign-in cookie', JSON.stringify(stateWith(cookie('NID', inDays(30))))],
    [
      'a sign-in cookie of another site',
      JSON.stringify(stateWith(cookie('SID', 1, '.example.com'))),
    ],
  ])('rejects %s', (_, text) => {
    expect(() => parseGoogleSession(text)).toThrow(InvalidGoogleSessionError);
  });
});

describe('describeGoogleSession', () => {
  it('is missing without a state', () => {
    expect(describeGoogleSession(undefined, false, NOW)).toEqual({
      status: 'missing',
      expiresAt: null,
    });
  });

  it('is valid until the latest sign-in cookie expires', () => {
    const state = stateWith(cookie('SID', inDays(5)), cookie('__Secure-1PSID', inDays(20)));
    expect(describeGoogleSession(state, false, NOW)).toEqual({
      status: 'valid',
      expiresAt: new Date(inDays(20) * 1000),
    });
  });

  it('is expired when every sign-in cookie is past its expiry', () => {
    const state = stateWith(cookie('SID', inDays(-1)), cookie('NID', inDays(30)));
    expect(describeGoogleSession(state, false, NOW).status).toBe('expired');
  });

  it('treats session cookies as valid and a marked session as expired', () => {
    const state = stateWith(cookie('SID', -1));
    expect(describeGoogleSession(state, false, NOW)).toEqual({ status: 'valid', expiresAt: null });
    expect(describeGoogleSession(state, true, NOW).status).toBe('expired');
  });
});

describe('Google session storage', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;
  const state = stateWith(cookie('SID', Date.now() / 1000 + 86_400));

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('stores the session encrypted and reads it back', async () => {
    await saveGoogleSession(store, state);
    const [row] = await test.db.select().from(settings);
    expect(row?.secret).toBe(true);
    expect(row?.value).not.toContain('secret-cookie-value');
    expect(await loadGoogleSession(store)).toEqual(state);
    expect((await loadGoogleSessionInfo(store)).status).toBe('valid');
  });

  it('reports expired once the bot marked it, and a new session clears the mark', async () => {
    await markGoogleSessionExpired(store);
    expect((await loadGoogleSessionInfo(store)).status).toBe('expired');
    await refreshGoogleSession(store, state);
    expect((await loadGoogleSessionInfo(store)).status).toBe('expired');
    await saveGoogleSession(store, state);
    expect((await loadGoogleSessionInfo(store)).status).toBe('valid');
  });

  it('forgets the session', async () => {
    await clearGoogleSession(store);
    expect(await loadGoogleSession(store)).toBeUndefined();
    expect((await loadGoogleSessionInfo(store)).status).toBe('missing');
  });
});
