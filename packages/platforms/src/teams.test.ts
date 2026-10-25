import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { fixturePage } from './fixture-pages.js';
import { detectPlatform } from './index.js';
import { teams } from './teams.js';

const hasChromium = existsSync(chromium.executablePath());
const meeting = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0';

describe('teams.detect', () => {
  it.each([
    meeting,
    'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d',
    'https://teams.microsoft.com/meet/123456789012?p=AbCdEf',
    'https://teams.live.com/meet/9876543210123?p=AbCdEf',
    'https://teams.live.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0',
  ])('accepts %s', (url) => {
    expect(detectPlatform(url)).toBe(teams);
  });

  it.each([
    'https://teams.microsoft.com/',
    'https://teams.microsoft.com/meet/',
    'https://teams.microsoft.com/l/chat/0/0',
    'https://teams.microsoft.com.evil.example/meet/123?p=a',
    'https://example.com/meet/123?p=a',
    'not a url',
  ])('rejects %s', (url) => {
    expect(detectPlatform(url)).toBeUndefined();
  });
});

describe.skipIf(!hasChromium)('teams join flow against the fixtures', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  });
  afterAll(() => browser.close());

  async function open(): Promise<Page> {
    const context = await browser.newContext();
    await context.route(/^https:\/\/teams\.(microsoft|live)\.com\//, (route) => {
      const body = fixturePage(new URL(route.request().url()));
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

  it('joins as a muted guest after the lobby and reads the room', async () => {
    const page = await open();
    let lobbySeen = false;
    await teams.join(page, `${meeting}?lobby=800&speakers=Alice:0-60000`, {
      ...options(),
      onLobby: () => {
        lobbySeen = true;
      },
    });

    expect(lobbySeen).toBe(true);
    expect(await teams.state(page)).toBe('active');
    await expect
      .poll(() => teams.scrapeRoom(page, 'OpenMinutes Notetaker'))
      .toEqual({ participants: ['Alice', 'Bob', 'OpenMinutes Notetaker'], speaking: ['Alice'] });

    await teams.leave(page);
    await page.waitForURL(/\/fixture\/left/);
    expect(await teams.state(page)).toBe('ended');
  });

  it('lists any number of guests and reports those who speak at once', async () => {
    const page = await open();
    const guests = 'others=Alice,Bob,Carol,Dave,Erin&speakers=Carol:0-60000,Erin:0-60000';
    await teams.join(page, `${meeting}?lobby=100&${guests}`, options());
    await expect
      .poll(() => teams.scrapeRoom(page, 'OpenMinutes Notetaker'))
      .toEqual({
        participants: ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'OpenMinutes Notetaker'],
        speaking: ['Carol', 'Erin'],
      });
  });

  it('reports the bot alone when Teams shows no tiles', async () => {
    const page = await open();
    await teams.join(page, `${meeting}?lobby=100&others=`, options());
    await expect
      .poll(() => teams.scrapeRoom(page, 'OpenMinutes Notetaker'))
      .toEqual({ participants: ['OpenMinutes Notetaker'], speaking: [] });
  });

  it('turns the camera and microphone off before joining', async () => {
    const page = await open();
    await teams.join(page, `${meeting}?lobby=100`, options());
    expect(await page.locator('body').getAttribute('data-mic')).toBe('off');
    expect(await page.locator('body').getAttribute('data-camera')).toBe('off');
  });

  it('scrapes the chat, opens the panel and maps the own messages to the bot name', async () => {
    const page = await open();
    await teams.join(
      page,
      `${meeting}?lobby=100&chat=Alice|0|Agenda https://example.com/a.;Bob|50|Thanks`,
      options(),
    );
    await expect
      .poll(async () => (await teams.scrapeChat(page, 'OpenMinutes Notetaker')).length)
      .toBe(2);
    expect(await page.locator('#chat').isVisible()).toBe(true);

    await teams.sendChatMessage(page, 'Hello from OpenMinutes');
    const messages = await teams.scrapeChat(page, 'OpenMinutes Notetaker');
    expect(messages.map((m) => [m.sender, m.text, m.links])).toEqual([
      ['Alice', 'Agenda https://example.com/a.', ['https://example.com/a']],
      ['Bob', 'Thanks', []],
      ['OpenMinutes Notetaker', 'Hello from OpenMinutes', []],
    ]);
  });

  it('keeps the camera on and sends a chat message when asked to', async () => {
    const page = await open();
    await teams.join(page, `${meeting}?lobby=100`, { ...options(), cameraOn: true });
    expect(await page.locator('body').getAttribute('data-camera')).toBe('on');

    await teams.sendChatMessage(page, 'Hello from OpenMinutes');
    await expect
      .poll(() => page.locator('#chat-log [data-own]').allTextContents())
      .toEqual(['Hello from OpenMinutes']);
    await teams.sendChatMessage(page, 'Second message');
    await expect
      .poll(() => page.locator('#chat-log [data-own]').allTextContents())
      .toEqual(['Hello from OpenMinutes', 'Second message']);
  });

  it('reports a tenant that blocks anonymous guests', async () => {
    const attempt = teams.join(await open(), `${meeting}?blocked=1`, options());
    await expect(attempt).rejects.toMatchObject({
      reason: 'anonymous_blocked',
      message: 'This tenant blocks anonymous guests',
    });
  });

  it('reports a denied request', async () => {
    const attempt = teams.join(await open(), `${meeting}?lobby=300&deny=1`, options());
    await expect(attempt).rejects.toMatchObject({ reason: 'denied' });
  });

  it('reports a meeting that ended while waiting', async () => {
    const attempt = teams.join(await open(), `${meeting}?lobby=300&endedLobby=1`, options());
    await expect(attempt).rejects.toMatchObject({ reason: 'meeting_ended' });
  });

  it('times out in the lobby', async () => {
    const attempt = teams.join(await open(), `${meeting}?lobby=60000`, options(1_500));
    await expect(attempt).rejects.toMatchObject({ reason: 'lobby_timeout' });
  });
});
