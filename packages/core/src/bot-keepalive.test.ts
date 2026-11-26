import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { botAccountName } from './bot-account-name.js';
import {
  botAlertDue,
  botNotificationsEnabled,
  botSessionExpiringSoon,
  loadBotKeepAlive,
  markBotAlertSent,
  recordBotKeepAlive,
  setBotNotifications,
} from './bot-keepalive.js';
import { saveBotSession, type BotStorageState } from './bot-session-store.js';
import { SettingsStore } from './settings.js';

const NOW = new Date('2026-11-26T12:00:00Z');
const at = (hours: number) => NOW.getTime() / 1000 + hours * 3600;
const microsoft = (expires: number, localStorage: { name: string; value: string }[] = []) => ({
  cookies: [
    {
      name: 'ESTSAUTHPERSISTENT',
      value: 'v',
      domain: '.login.microsoftonline.com',
      path: '/',
      expires,
      httpOnly: true,
      secure: true,
      sameSite: 'None' as const,
    },
  ],
  origins: [{ origin: 'https://teams.microsoft.com', localStorage }],
});

describe('per-provider keep-alive state', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;
  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('keeps the keep-alive record of each provider apart', async () => {
    await recordBotKeepAlive('microsoft', store, 'failed', 'Signed out', NOW);
    expect(await loadBotKeepAlive('microsoft', store)).toEqual({
      at: NOW.toISOString(),
      status: 'failed',
      detail: 'Signed out',
    });
    expect(await loadBotKeepAlive('google', store)).toBeUndefined();
  });

  it('throttles alerts per provider', async () => {
    await markBotAlertSent('google', store, NOW);
    expect(await botAlertDue('google', store, NOW)).toBe(false);
    expect(await botAlertDue('microsoft', store, NOW)).toBe(true);
    await markBotAlertSent('microsoft', store, NOW);
    expect(await botAlertDue('microsoft', store, new Date(NOW.getTime() + 25 * 3_600_000))).toBe(
      true,
    );
  });

  it('switches notifications per provider', async () => {
    await setBotNotifications('microsoft', store, false);
    expect(await botNotificationsEnabled('microsoft', store)).toBe(false);
    expect(await botNotificationsEnabled('google', store)).toBe(true);
  });

  it('warns about a Microsoft cookie that ends within 72 hours', async () => {
    await saveBotSession('microsoft', store, microsoft(at(70)));
    expect(await botSessionExpiringSoon('microsoft', store, NOW)).toEqual(new Date(at(70) * 1000));
    await saveBotSession('microsoft', store, microsoft(at(80)));
    expect(await botSessionExpiringSoon('microsoft', store, NOW)).toBeUndefined();
    await saveBotSession('microsoft', store, microsoft(-1));
    expect(await botSessionExpiringSoon('microsoft', store, NOW)).toBeUndefined();
  });
});

describe('botAccountName', () => {
  const account = (name: unknown, authorityType = 'MSSTS') => ({
    name: 'abc.def-login.windows.net-tenant',
    value: JSON.stringify({ authorityType, name, username: 'bot@example.com' }),
  });
  const withEntries = (...entries: { name: string; value: string }[]): BotStorageState =>
    microsoft(at(100), entries);

  it('reads the MSAL account name Teams shows', () => {
    expect(
      botAccountName(withEntries({ name: 'msal.token', value: 'opaque' }, account(' Notes Bot '))),
    ).toBe('Notes Bot');
  });

  it('gives nothing when the name is missing, unclear or not from MSAL', () => {
    expect(botAccountName(undefined)).toBeUndefined();
    expect(botAccountName(withEntries())).toBeUndefined();
    expect(botAccountName(withEntries({ name: 'x', value: '{broken' }))).toBeUndefined();
    expect(botAccountName(withEntries(account('Notes Bot', 'ADFS')))).toBeUndefined();
    expect(botAccountName(withEntries(account('  ')))).toBeUndefined();
    expect(botAccountName(withEntries(account(42)))).toBeUndefined();
    expect(botAccountName(withEntries(account('Notes Bot'), account('Carla')))).toBeUndefined();
    expect(botAccountName(withEntries(account('Notes Bot'), account('Notes Bot')))).toBe(
      'Notes Bot',
    );
  });
});
