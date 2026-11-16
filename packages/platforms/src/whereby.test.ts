import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { fixturePage } from './fixture-pages.js';
import { detectPlatform } from './index.js';
import { whereby } from './whereby.js';

const hasChromium = existsSync(chromium.executablePath());
const room = 'https://whereby.com/openminutes-test';

describe('whereby.detect', () => {
  it.each([room, 'https://acme.whereby.com/standup', 'whereby.com/Some-Room?roomKey=abc'])(
    'accepts %s',
    (url) => {
      expect(detectPlatform(url)).toBe(whereby);
    },
  );

  it.each([
    'https://whereby.com/',
    'https://whereby.com/user/login',
    'https://whereby.com.evil.example/x',
  ])('rejects %s', (url) => {
    expect(detectPlatform(url)).toBeUndefined();
  });
});

describe.skipIf(!hasChromium)('whereby join flow against the fixtures', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  });
  afterAll(() => browser.close());

  // Only whereby.com requests are answered, and only from the local fixture. Nothing leaves the machine.
  async function open(): Promise<Page> {
    const context = await browser.newContext();
    await context.route(/^https:\/\/whereby\.com\//, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/__event') return route.fulfill({ status: 204 });
      const body = fixturePage(url);
      return body
        ? route.fulfill({ contentType: 'text/html', body })
        : route.fulfill({ status: 404 });
    });
    return context.newPage();
  }

  const options = (lobbyTimeoutMs = 5_000) => ({
    displayName: 'OpenMinutes Notetaker',
    cameraOn: false,
    lobbyTimeoutMs,
    onLobby: () => undefined,
  });

  it('enters the name, knocks, waits in the lobby and reads the room', async () => {
    const page = await open();
    let lobbySeen = false;
    await whereby.join(page, `${room}?nameStep=1&noDevices=1&lobby=800&speakers=Alice:0-60000`, {
      ...options(),
      onLobby: () => {
        lobbySeen = true;
      },
    });
    expect(lobbySeen).toBe(true);
    expect(await whereby.state(page)).toBe('active');
    await expect
      .poll(() => whereby.scrapeRoom(page, 'OpenMinutes Notetaker'))
      .toEqual({
        participants: ['Alice', 'Bob', 'OpenMinutes Notetaker'],
        speaking: ['Alice'],
        headcount: 3,
      });
    expect(await page.locator('.jstest-mute-button').getAttribute('aria-pressed')).toBe('false');

    await whereby.leave(page);
    expect(await whereby.state(page)).toBe('ended');
  });

  it('joins an unlocked room without knocking', async () => {
    const page = await open();
    await whereby.join(page, `${room}?nameStep=1&locked=0`, options());
    expect(await whereby.state(page)).toBe('active');
  });

  it('scrapes the chat and sends a message as the bot', async () => {
    const page = await open();
    await whereby.join(
      page,
      `${room}?nameStep=1&lobby=100&chat=Alice|0|Agenda https://example.com/a.`,
      options(),
    );
    await expect
      .poll(async () => (await whereby.scrapeChat(page, 'OpenMinutes Notetaker')).length)
      .toBe(1);
    await whereby.sendChatMessage(page, 'Hello from OpenMinutes');
    const messages = await whereby.scrapeChat(page, 'OpenMinutes Notetaker');
    expect(messages.map((m) => [m.sender, m.text, m.links])).toEqual([
      ['Alice', 'Agenda https://example.com/a.', ['https://example.com/a']],
      ['OpenMinutes Notetaker', 'Hello from OpenMinutes', []],
    ]);
  });

  it('reports a denied knock', async () => {
    const attempt = whereby.join(await open(), `${room}?nameStep=1&lobby=300&deny=1`, options());
    await expect(attempt).rejects.toMatchObject({ reason: 'denied' });
  });

  it('times out in the lobby', async () => {
    const attempt = whereby.join(await open(), `${room}?nameStep=1&lobby=60000`, options(1_500));
    await expect(attempt).rejects.toMatchObject({ reason: 'lobby_timeout' });
  });

  it('notices when the host ends the meeting', async () => {
    const page = await open();
    await whereby.join(page, `${room}?nameStep=1&locked=0&leaveAfter=2000`, options());
    await expect.poll(() => whereby.state(page), { timeout: 10_000 }).toBe('ended');
  }, 20_000);
});
