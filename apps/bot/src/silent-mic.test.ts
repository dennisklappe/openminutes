import { existsSync } from 'node:fs';
import { BOT_DEFAULTS } from '@openminutes/core';
import { fixturePage, meet, teams, type Platform } from '@openminutes/platforms';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareBotSession } from './bot-session.js';
import type { BotEnv } from './env.js';
import { installMicGuard, loudMicSamples } from './mic-guard.js';

const env = { OPENMINUTES_CHROMIUM_ARGS: [] } as unknown as BotEnv;
const profile = { name: BOT_DEFAULTS.name, joinMessage: null, cameraImagePath: null };
const hasChromium = existsSync(chromium.executablePath());
const beepingArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

const targets: { platform: Platform; url: string }[] = [
  { platform: meet, url: 'https://meet.google.com/abc-defg-hij?lobby=100' },
  {
    platform: teams,
    url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?lobby=100',
  },
];

describe.skipIf(!hasChromium).each(targets)('outgoing microphone ($platform.id)', (target) => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  async function join(args: string[], query: string, guard = false): Promise<Page> {
    const browser: Browser = await chromium.launch({ args });
    cleanups.push(() => browser.close());
    const context = await browser.newContext();
    if (guard) await installMicGuard(context);
    await context.route(
      /^https:\/\/(meet\.google\.com|teams\.(microsoft|live)\.com)\//,
      (route) => {
        const body = fixturePage(new URL(route.request().url()));
        return body
          ? route.fulfill({ contentType: 'text/html', body })
          : route.fulfill({ status: 404 });
      },
    );
    const page = await context.newPage();
    await target.platform.join(page, `${target.url}&${query}`, {
      displayName: profile.name,
      cameraOn: false,
      lobbyTimeoutMs: 10_000,
      onLobby: () => undefined,
    });
    return page;
  }

  const peak = async (page: Page) =>
    Number(await page.locator('body').getAttribute('data-mic-peak'));
  const unmuted = 'micOnAfterJoin=1&micLocked=1';

  it('never sends sound with the bot launch arguments, even when the page keeps the mic on', async () => {
    const session = await prepareBotSession(profile, env);
    cleanups.push(() => session.dispose());
    const page = await join(session.chromiumArgs, unmuted);
    await expect.poll(() => page.locator('body').getAttribute('data-mic')).toBe('on');
    await expect.poll(() => peak(page)).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(3_000);
    expect(await peak(page)).toBe(0);
  });

  it('detects the fake device beep when it is not fed silence', async () => {
    const page = await join(beepingArgs, unmuted);
    await expect.poll(() => peak(page), { timeout: 10_000 }).toBeGreaterThan(0.05);
  });

  it('mutes the microphone again after the page turned it on', async () => {
    const session = await prepareBotSession(profile, env);
    cleanups.push(() => session.dispose());
    const page = await join(session.chromiumArgs, 'micOnAfterJoin=1');
    await expect.poll(() => page.locator('body').getAttribute('data-mic')).toBe('on');
    await expect(target.platform.muteMicrophone(page)).resolves.toBe(true);
    expect(await page.locator('body').getAttribute('data-mic')).toBe('off');
  });

  it('reports a microphone that cannot be muted', async () => {
    const session = await prepareBotSession(profile, env);
    cleanups.push(() => session.dispose());
    const page = await join(session.chromiumArgs, unmuted);
    await expect(target.platform.muteMicrophone(page)).resolves.toBe(false);
  });

  it('the guard sees a loud outgoing track and switches it off', async () => {
    const page = await join(beepingArgs, unmuted, true);
    await expect.poll(() => loudMicSamples(page), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  it('the guard stays quiet while the bot sends silence', async () => {
    const session = await prepareBotSession(profile, env);
    cleanups.push(() => session.dispose());
    const page = await join(session.chromiumArgs, unmuted, true);
    await page.waitForTimeout(2_000);
    expect(await loudMicSamples(page)).toBe(0);
  });
});
