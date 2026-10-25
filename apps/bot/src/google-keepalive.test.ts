import {
  loadGoogleSession,
  loadKeepAlive,
  SettingsStore,
  saveGoogleCredentials,
  saveGoogleSession,
} from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleBrowser, GooglePage } from './google-browser.js';
import { runGoogleKeepAlive } from './google-keepalive.js';

const cookie = (name: string, expires: number) => ({
  name,
  value: 'v',
  domain: '.google.com',
  path: '/',
  expires,
  httpOnly: true,
  secure: true,
  sameSite: 'None' as const,
});
const inDays = (days: number) => Date.now() / 1000 + days * 86_400;
const stored = (days: number) => ({ cookies: [cookie('SID', inDays(days))], origins: [] });

interface Script {
  landing: string;
  loginUrls?: string[];
  signedInAfterLogin?: boolean;
  visible?: Set<string>;
  failLaunch?: boolean;
}

function fakeBrowser(script: Script) {
  const fills: string[] = [];
  let loggedIn = false;
  let url = 'about:blank';
  const urls = [...(script.loginUrls ?? [])];
  const visible = script.visible ?? new Set<string>();
  const page: GooglePage = {
    goto: (target) => {
      url = target.includes('accounts.google.com') ? target : script.landing;
      return Promise.resolve();
    },
    url: () => url,
    locator: (selector) => ({
      isVisible: () => Promise.resolve(visible.has(selector)),
      fill: (value) => {
        fills.push(`${selector}=${value}`);
        return Promise.resolve();
      },
      click: () => {
        if (selector === '#passwordNext' || selector === '#totpNext') {
          loggedIn = script.signedInAfterLogin ?? false;
          visible.clear();
          url = urls.shift() ?? url;
        }
        if (selector === '#identifierNext') visible.add('input[name="Passwd"]');
        return Promise.resolve();
      },
    }),
    waitForTimeout: () => Promise.resolve(),
  };
  const browser: GoogleBrowser = {
    newContext: () =>
      Promise.resolve({
        newPage: () => Promise.resolve(page),
        storageState: () => Promise.resolve(stored(60)),
        cookies: () => Promise.resolve(loggedIn ? [{ name: 'SID' }] : []),
      }),
    close: () => Promise.resolve(),
  };
  const launch = vi.fn(() =>
    script.failLaunch ? Promise.reject(new Error('no chromium')) : Promise.resolve(browser),
  );
  return { launch, fills };
}

describe('Google keep-alive', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  const queue = { send: vi.fn(() => Promise.resolve()) };

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());
  beforeEach(async () => {
    queue.send.mockClear();
    for (const key of [
      'bot.google_session',
      'bot.google_credentials',
      'bot.google_keepalive',
    ] as const) {
      await settings.delete(key);
    }
    await settings.delete('bot.google_session_expired');
  });

  const run = (script: Script) => {
    const browser = fakeBrowser(script);
    return runGoogleKeepAlive({ settings, queue, launch: browser.launch }).then(() => browser);
  };

  it('does nothing without a session or credentials', async () => {
    const browser = await run({ landing: 'https://myaccount.google.com/' });
    expect(browser.launch).not.toHaveBeenCalled();
    expect(await loadKeepAlive(settings)).toBeUndefined();
  });

  it('refreshes a live session and clears the expired mark', async () => {
    await saveGoogleSession(settings, stored(2));
    await settings.set('bot.google_session_expired', 'true');
    await run({ landing: 'https://myaccount.google.com/' });
    expect((await loadKeepAlive(settings))?.status).toBe('ok');
    expect(await settings.get('bot.google_session_expired')).toBeUndefined();
    expect((await loadGoogleSession(settings))?.cookies[0]?.expires).toBeGreaterThan(inDays(50));
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('alerts when the session was ended and no password is saved', async () => {
    await saveGoogleSession(settings, stored(30));
    await run({ landing: 'https://accounts.google.com/ServiceLogin' });
    expect((await loadKeepAlive(settings))?.status).toBe('failed');
    expect(await settings.get('bot.google_session_expired')).toBe('true');
    expect(queue.send).toHaveBeenCalledWith('bot.session-alert', expect.anything());
  });

  it('signs in again with the saved password and a code', async () => {
    await saveGoogleSession(settings, stored(30));
    await saveGoogleCredentials(settings, {
      email: 'bot@example.com',
      password: 'hunter2',
      totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    });
    const browser = await run({
      landing: 'https://accounts.google.com/ServiceLogin',
      signedInAfterLogin: true,
    });
    expect(browser.fills).toContain('input[name="Passwd"]=hunter2');
    expect((await loadKeepAlive(settings))?.status).toBe('ok');
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('marks needs attention when Google asks for a challenge', async () => {
    await saveGoogleCredentials(settings, { email: 'bot@example.com', password: 'pw' });
    await run({
      landing: 'https://accounts.google.com/ServiceLogin',
      loginUrls: ['https://accounts.google.com/v3/signin/challenge/ipp/collect'],
    });
    const record = await loadKeepAlive(settings);
    expect(record?.status).toBe('needs_attention');
    expect(record?.detail).toMatch(/extra verification/);
    expect(queue.send).toHaveBeenCalledWith('bot.session-alert', { reason: record?.detail });
  });

  it('records a failed run when the browser cannot start', async () => {
    await saveGoogleSession(settings, stored(30));
    await run({ landing: '', failLaunch: true });
    expect((await loadKeepAlive(settings))?.detail).toMatch(/no chromium/);
    expect(queue.send).toHaveBeenCalled();
  });
});
