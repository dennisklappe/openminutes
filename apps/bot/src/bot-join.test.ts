import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOT_DEFAULTS, type BotProfile } from '@openminutes/core';
import { fixturePage, meet, teams, type Platform } from '@openminutes/platforms';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareBotSession } from './bot-session.js';
import type { BotEnv } from './env.js';

const hasTooling =
  existsSync(chromium.executablePath()) && spawnSync('ffmpeg', ['-version']).status === 0;
const env = { OPENMINUTES_CHROMIUM_ARGS: [] } as unknown as BotEnv;

const targets: { platform: Platform; url: string }[] = [
  { platform: meet, url: 'https://meet.google.com/abc-defg-hij?lobby=100' },
  {
    platform: teams,
    url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?lobby=100',
  },
];

function averageColor(imagePath: string | URL): number[] {
  const source = typeof imagePath === 'string' ? imagePath : imagePath.pathname;
  const { stdout } = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', source, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer' },
  );
  return [...stdout];
}

describe.skipIf(!hasTooling).each(targets)(
  'bot join with fake devices ($platform.id)',
  (target) => {
    let workDir: string;
    let redImage: string;

    beforeAll(async () => {
      workDir = await mkdtemp(join(tmpdir(), 'openminutes-branded-'));
      redImage = join(workDir, 'red.png');
      spawnSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=0xd02020:s=320x180',
        '-frames:v',
        '1',
        redImage,
      ]);
    });
    afterAll(() => rm(workDir, { recursive: true, force: true }));

    async function joinAs(profile: BotProfile) {
      const session = await prepareBotSession(profile, env);
      const browser: Browser = await chromium.launch({ args: session.chromiumArgs });
      const context = await browser.newContext();
      await context.route(
        /^https:\/\/(meet\.google\.com|teams\.(microsoft|live)\.com)\//,
        (route) => {
          const body = fixturePage(new URL(route.request().url()));
          return body
            ? route.fulfill({ contentType: 'text/html', body })
            : route.fulfill({ status: 404 });
        },
      );
      const page: Page = await context.newPage();
      await target.platform.join(page, target.url, {
        displayName: session.displayName,
        cameraOn: session.cameraOn,
        lobbyTimeoutMs: 10_000,
        onLobby: () => undefined,
      });
      if (session.joinMessage) await target.platform.sendChatMessage(page, session.joinMessage);
      const done = async () => {
        await browser.close();
        await session.dispose();
      };
      return { page, session, done };
    }

    const frame = async (page: Page) => {
      await page.locator('body[data-camera-frame]').waitFor({ state: 'attached' });
      const text = await page.locator('body').getAttribute('data-camera-frame');
      return (text ?? '').split(',').map(Number);
    };
    const closeTo = (actual: number[], expected: number[]) =>
      actual.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= 16);

    it('joins as OpenMinutes Notetaker with the default message and the camera off', async () => {
      const { page, done } = await joinAs({
        name: BOT_DEFAULTS.name,
        joinMessage: BOT_DEFAULTS.joinMessage,
        cameraImagePath: null,
      });
      try {
        await expect
          .poll(
            async () => (await target.platform.scrapeRoom(page, BOT_DEFAULTS.name)).participants,
          )
          .toContain(BOT_DEFAULTS.name);
        await expect
          .poll(() => page.locator('#chat-log [data-own]').allTextContents())
          .toEqual([BOT_DEFAULTS.joinMessage]);
        expect(await page.locator('body').getAttribute('data-camera')).toBe('off');
        expect(await page.locator('body').getAttribute('data-camera-frame')).toBeNull();
      } finally {
        await done();
      }
    });

    it('joins with the custom name, image and message', async () => {
      const { page, done } = await joinAs({
        name: 'Acme Notes',
        joinMessage: 'Recording for Acme',
        cameraImagePath: redImage,
      });
      try {
        await expect
          .poll(async () => (await target.platform.scrapeRoom(page, 'Acme Notes')).participants)
          .toContain('Acme Notes');
        await expect
          .poll(() => page.locator('#chat-log [data-own]').allTextContents())
          .toEqual(['Recording for Acme']);
        expect(closeTo(await frame(page), averageColor(redImage))).toBe(true);
      } finally {
        await done();
      }
    });
  },
);
