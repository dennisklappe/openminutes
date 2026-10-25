import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  saveGoogleCredentials,
  loadGoogleCredentials,
  loadGoogleCredentialsInfo,
  InvalidGoogleCredentialsError,
} from './google-credentials.js';
import {
  alertDue,
  expiringSoon,
  loadKeepAlive,
  markAlertSent,
  notificationsEnabled,
  recordKeepAlive,
} from './google-keepalive.js';
import { saveGoogleSession } from './google-session.js';
import { SettingsStore } from './settings.js';

const NOW = new Date('2026-10-22T12:00:00Z');
const at = (hours: number) => NOW.getTime() / 1000 + hours * 3600;
const session = (...expires: number[]) => ({
  cookies: expires.map((e, i) => ({
    name: i === 0 ? 'SID' : '__Secure-1PSID',
    value: 'v',
    domain: '.google.com',
    path: '/',
    expires: e,
    httpOnly: true,
    secure: true,
    sameSite: 'None' as const,
  })),
  origins: [],
});

describe('keep-alive state', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;
  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('flags a session whose earliest critical cookie ends within 72 hours', async () => {
    await saveGoogleSession(store, session(at(24 * 30), at(70)));
    expect(await expiringSoon(store, NOW)).toEqual(new Date(at(70) * 1000));
    await saveGoogleSession(store, session(at(24 * 30), at(80)));
    expect(await expiringSoon(store, NOW)).toBeUndefined();
  });

  it('allows one alert per day', async () => {
    expect(await alertDue(store, NOW)).toBe(true);
    await markAlertSent(store, NOW);
    expect(await alertDue(store, new Date(NOW.getTime() + 3_600_000))).toBe(false);
    expect(await alertDue(store, new Date(NOW.getTime() + 25 * 3_600_000))).toBe(true);
  });

  it('records the last keep-alive and defaults notifications on', async () => {
    expect(await loadKeepAlive(store)).toBeUndefined();
    await recordKeepAlive(store, 'needs_attention', 'Google asked for a code', NOW);
    expect(await loadKeepAlive(store)).toEqual({
      at: NOW.toISOString(),
      status: 'needs_attention',
      detail: 'Google asked for a code',
    });
    expect(await notificationsEnabled(store)).toBe(true);
  });

  it('keeps stored secrets when only the email is re-sent and exposes flags only', async () => {
    await saveGoogleCredentials(store, {
      email: 'bot@example.com',
      password: 'pw',
      totpSecret: 'GEZDGNBVGY3TQOJQ',
    });
    await saveGoogleCredentials(store, { email: 'bot@example.com' });
    expect(await loadGoogleCredentials(store)).toMatchObject({
      password: 'pw',
      totpSecret: 'GEZDGNBVGY3TQOJQ',
    });
    const info = await loadGoogleCredentialsInfo(store);
    expect(info).toEqual({ email: 'bot@example.com', hasPassword: true, hasTotp: true });
    expect(JSON.stringify(info)).not.toContain('pw"');
  });

  it('rejects a new email without a password and a bad authenticator secret', async () => {
    await expect(saveGoogleCredentials(store, { email: 'other@example.com' })).rejects.toThrow(
      InvalidGoogleCredentialsError,
    );
    await expect(
      saveGoogleCredentials(store, { email: 'bot@example.com', totpSecret: '!!' }),
    ).rejects.toThrow(InvalidGoogleCredentialsError);
  });
});
