import { loadBotKeepAlive, loadBotSession, saveBotSession, SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleBrowser, GooglePage } from './google-browser.js';
import { runMicrosoftKeepAlive, SETTLE_MS } from './microsoft-keepalive.js';

const inDays = (days: number) => Date.now() / 1000 + days * 86_400;
const stored = (days: number) => ({
  cookies: [
    {
      name: 'ESTSAUTHPERSISTENT',
      value: 'v',
      domain: '.login.microsoftonline.com',
      path: '/',
      expires: inDays(days),
      httpOnly: true,
      secure: true,
      sameSite: 'None' as const,
    },
  ],
  origins: [],
});

interface Script {
  /** Where the page is after Teams' scripts had their time. */
  settled: string;
  failLaunch?: boolean;
}

function fakeBrowser(script: Script) {
  let url = 'about:blank';
  const waits: number[] = [];
  const storageOptions: unknown[] = [];
  const page: GooglePage = {
    goto: (target) => {
      url = target;
      return Promise.resolve();
    },
    url: () => url,
    locator: () => {
      throw new Error('the keep-alive does not fill anything');
    },
    waitForTimeout: (ms) => {
      waits.push(ms);
      url = script.settled;
      return Promise.resolve();
    },
  };
  const close = vi.fn(() => Promise.resolve());
  const browser: GoogleBrowser = {
    newContext: () =>
      Promise.resolve({
        newPage: () => Promise.resolve(page),
        storageState: (options) => {
          storageOptions.push(options);
          return Promise.resolve(stored(90));
        },
        cookies: () => Promise.resolve([]),
      }),
    close,
  };
  const launch = vi.fn(() =>
    script.failLaunch ? Promise.reject(new Error('no chromium')) : Promise.resolve(browser),
  );
  return { launch, waits, storageOptions, browser, close };
}

describe('Microsoft keep-alive', () => {
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
      'bot.microsoft_session',
      'bot.microsoft_session_expired',
      'bot.microsoft_keepalive',
      'bot.google_keepalive',
    ] as const) {
      await settings.delete(key);
    }
  });

  const run = (script: Script) => {
    const fake = fakeBrowser(script);
    return runMicrosoftKeepAlive({ settings, queue, launch: fake.launch }).then(() => fake);
  };

  it('does nothing without a Microsoft session', async () => {
    const fake = await run({ settled: 'https://teams.microsoft.com/v2/' });
    expect(fake.launch).not.toHaveBeenCalled();
    expect(await loadBotKeepAlive('microsoft', settings)).toBeUndefined();
  });

  it('refreshes a live session with IndexedDB and clears the expired mark', async () => {
    await saveBotSession('microsoft', settings, stored(30));
    await settings.set('bot.microsoft_session_expired', 'true');
    const fake = await run({ settled: 'https://teams.cloud.microsoft/' });
    expect(fake.waits).toEqual([SETTLE_MS]);
    expect(fake.storageOptions).toEqual([{ indexedDB: true }]);
    expect((await loadBotKeepAlive('microsoft', settings))?.status).toBe('ok');
    expect(await loadBotKeepAlive('google', settings)).toBeUndefined();
    expect(await settings.get('bot.microsoft_session_expired')).toBeUndefined();
    expect((await loadBotSession('microsoft', settings))?.cookies[0]?.expires).toBeGreaterThan(
      inDays(80),
    );
    expect(fake.close).toHaveBeenCalled();
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('marks the session signed out and alerts with the Microsoft provider', async () => {
    await saveBotSession('microsoft', settings, stored(30));
    await run({ settled: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' });
    const record = await loadBotKeepAlive('microsoft', settings);
    expect(record?.status).toBe('failed');
    expect(await settings.get('bot.microsoft_session_expired')).toBe('true');
    expect(queue.send).toHaveBeenCalledWith('bot.session-alert', {
      reason: record?.detail,
      provider: 'microsoft',
    });
  });

  it('warns when the sign-in cookie ends soon after the refresh', async () => {
    await saveBotSession('microsoft', settings, stored(30));
    const fake = fakeBrowser({ settled: 'https://teams.microsoft.com/v2/' });
    const browser: GoogleBrowser = {
      ...fake.browser,
      newContext: async (options) => ({
        ...(await fake.browser.newContext(options)),
        storageState: () => Promise.resolve(stored(1)),
      }),
    };
    await runMicrosoftKeepAlive({ settings, queue, launch: () => Promise.resolve(browser) });
    expect(queue.send).toHaveBeenCalledWith('bot.session-alert', {
      reason: expect.stringMatching(/Microsoft sign-in of the bot ends on/) as string,
      provider: 'microsoft',
    });
  });

  it('records a failed run when the browser cannot start', async () => {
    await saveBotSession('microsoft', settings, stored(30));
    await run({ settled: '', failLaunch: true });
    expect((await loadBotKeepAlive('microsoft', settings))?.detail).toMatch(/no chromium/);
    expect(await settings.get('bot.microsoft_session_expired')).toBeUndefined();
    expect(queue.send).toHaveBeenCalledWith(
      'bot.session-alert',
      expect.objectContaining({ provider: 'microsoft' }),
    );
  });
});
