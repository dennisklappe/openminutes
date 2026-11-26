import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  botSessionCriticalExpiry,
  clearBotSession,
  describeBotSession,
  InvalidBotSessionError,
  loadBotSession,
  loadBotSessionInfo,
  markBotSessionExpired,
  parseBotSession,
  saveBotSession,
  type BotAccountProvider,
} from './bot-session-store.js';
import { SettingsStore } from './settings.js';

const NOW = new Date('2026-11-26T12:00:00Z');
const inDays = (days: number) => NOW.getTime() / 1000 + days * 86_400;

const cookie = (name: string, domain: string, expires = inDays(30)) => ({
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

const google = stateWith(cookie('SID', '.google.com'));
const work = stateWith(cookie('ESTSAUTHPERSISTENT', '.login.microsoftonline.com'));
const personal = stateWith(cookie('ESTSAUTH', 'login.live.com', -1));

describe('parseBotSession', () => {
  it.each<[string, BotAccountProvider, object]>([
    ['a Google session', 'google', google],
    ['a Microsoft work account session', 'microsoft', work],
    ['a Microsoft personal account session', 'microsoft', personal],
  ])('accepts %s', (_, provider, state) => {
    expect(parseBotSession(provider, JSON.stringify(state)).cookies).toHaveLength(1);
  });

  it.each<[string, BotAccountProvider, object]>([
    ['a Google file as Microsoft', 'microsoft', google],
    ['a Microsoft file as Google', 'google', work],
    [
      'a Microsoft cookie name on another site',
      'microsoft',
      stateWith(cookie('ESTSAUTH', '.evilmicrosoftonline.com')),
    ],
  ])('rejects %s', (_, provider, state) => {
    expect(() => parseBotSession(provider, JSON.stringify(state))).toThrow(InvalidBotSessionError);
  });

  it('names the provider and its login script when the cookies are missing', () => {
    expect(() => parseBotSession('microsoft', JSON.stringify(google))).toThrow(
      'The file has no Microsoft sign-in cookies, sign in with scripts/microsoft-login.mjs first',
    );
  });

  it('keeps IndexedDB data of the storage state', () => {
    const state = {
      ...work,
      origins: [
        {
          origin: 'https://teams.microsoft.com',
          localStorage: [],
          indexedDB: [{ name: 'msal', version: 1, stores: [] }],
        },
      ],
    };
    expect(parseBotSession('microsoft', JSON.stringify(state)).origins[0]?.indexedDB).toEqual([
      { name: 'msal', version: 1, stores: [] },
    ]);
  });
});

describe('describeBotSession', () => {
  it('only counts the sign-in cookies of the provider', () => {
    const state = stateWith(
      cookie('SID', '.google.com', inDays(-1)),
      cookie('ESTSAUTHPERSISTENT', '.login.microsoftonline.com', inDays(60)),
    );
    expect(describeBotSession('google', state, false, NOW).status).toBe('expired');
    expect(describeBotSession('microsoft', state, false, NOW)).toEqual({
      status: 'valid',
      expiresAt: new Date(inDays(60) * 1000),
    });
  });

  it('treats a Microsoft session cookie as valid without an expiry date', () => {
    expect(describeBotSession('microsoft', personal, false, NOW)).toEqual({
      status: 'valid',
      expiresAt: null,
    });
    expect(botSessionCriticalExpiry('microsoft', personal)).toBeNull();
  });
});

describe('bot session storage per provider', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('keeps the Google and Microsoft sessions apart', async () => {
    await saveBotSession('google', store, google);
    expect(await loadBotSession('microsoft', store)).toBeUndefined();
    await saveBotSession('microsoft', store, work);
    await markBotSessionExpired('microsoft', store);
    expect((await loadBotSessionInfo('microsoft', store)).status).toBe('expired');
    expect((await loadBotSessionInfo('google', store)).status).toBe('valid');
    await clearBotSession('microsoft', store);
    expect((await loadBotSessionInfo('microsoft', store)).status).toBe('missing');
    expect(await loadBotSession('google', store)).toEqual(google);
  });
});
