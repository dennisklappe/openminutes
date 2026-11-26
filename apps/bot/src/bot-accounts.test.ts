import { loadBotSessionInfo, saveBotSession, SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { accountFor } from './bot-accounts.js';

const cookie = (name: string, domain: string) => ({
  name,
  value: 'v',
  domain,
  path: '/',
  expires: Date.now() / 1000 + 30 * 86_400,
  httpOnly: true,
  secure: true,
  sameSite: 'None' as const,
});
const google = { cookies: [cookie('SID', '.google.com')], origins: [] };
const microsoft = {
  cookies: [cookie('ESTSAUTHPERSISTENT', '.login.microsoftonline.com')],
  origins: [],
};

describe('accountFor', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('maps Meet to Google, Teams to Microsoft and leaves Whereby anonymous', () => {
    expect(accountFor('meet')?.provider).toBe('google');
    expect(accountFor('teams')?.provider).toBe('microsoft');
    expect(accountFor('whereby')).toBeUndefined();
  });

  it('stores IndexedDB only for the Microsoft session', () => {
    expect(accountFor('meet')?.indexedDB).toBe(false);
    expect(accountFor('teams')?.indexedDB).toBe(true);
  });

  it('joins Teams as a guest until a Microsoft session is imported', async () => {
    const teams = accountFor('teams');
    await saveBotSession('google', store, google);
    expect(await teams?.load(store)).toBeUndefined();
    await saveBotSession('microsoft', store, microsoft);
    expect(await teams?.load(store)).toEqual(microsoft);
  });

  it('marks only the Microsoft session expired after a failed Teams join', async () => {
    await accountFor('teams')?.markExpired(store);
    expect((await loadBotSessionInfo('microsoft', store)).status).toBe('expired');
    expect((await loadBotSessionInfo('google', store)).status).toBe('valid');
  });

  it('cannot sign Teams back in without saved credentials', async () => {
    const launch = vi.fn();
    expect(await accountFor('teams')?.signIn({ settings: store, launch })).toEqual({ ok: false });
    expect(launch).not.toHaveBeenCalled();
  });
});
