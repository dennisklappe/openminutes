import { existsSync, readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectPlatform } from './index.js';
import { meet } from './meet.js';
import { JoinError } from './types.js';

const fixture = readFileSync(new URL('../fixtures/meet/index.html', import.meta.url), 'utf8');
const hasChromium = existsSync(chromium.executablePath());

describe('meet.detect', () => {
  it.each([
    'https://meet.google.com/abc-defg-hij',
    'https://meet.google.com/abc-defg-hij?authuser=0',
    'https://meet.google.com/lookup/abc123',
    'http://meet.google.com/abc-defg-hij',
    'meet.google.com/meet/abc-defg-hij',
  ])('accepts %s', (url) => {
    expect(detectPlatform(url)).toBe(meet);
  });

  it.each([
    'https://meet.google.com/',
    'https://meet.google.com/new',
    'https://example.com/abc-defg-hij',
  ])('rejects %s', (url) => {
    expect(detectPlatform(url)).toBeUndefined();
  });
});

describe.skipIf(!hasChromium)('meet join flow against the fixture', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  });
  afterAll(() => browser.close());

  async function open(signedIn = false): Promise<Page> {
    const context = await browser.newContext();
    if (signedIn) {
      await context.addCookies([
        { name: 'SID', value: 'fixture-session', domain: '.google.com', path: '/', expires: -1 },
      ]);
    }
    await context.route('https://meet.google.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: fixture }),
    );
    return context.newPage();
  }

  const options = (onLobby = () => undefined) => ({
    displayName: 'OpenMinutes Notetaker',
    cameraOn: false,
    lobbyTimeoutMs: 5_000,
    onLobby,
  });

  it('joins as a muted guest after the lobby', async () => {
    const page = await open();
    let lobbySeen = false;
    await meet.join(page, 'https://meet.google.com/abc-defg-hij?lobby=800', {
      ...options(),
      onLobby: () => {
        lobbySeen = true;
      },
    });

    expect(lobbySeen).toBe(true);
    expect(await page.locator('input').inputValue()).toBe('OpenMinutes Notetaker');
    expect(await page.locator('body').getAttribute('data-mic')).toBe('off');
    expect(await page.locator('body').getAttribute('data-camera')).toBe('off');
    expect(await meet.state(page)).toBe('active');
    await expect(meet.scrapeRoom(page, 'OpenMinutes Notetaker')).resolves.toMatchObject({
      participants: ['Alice', 'Bob', 'OpenMinutes Notetaker'],
      speaking: [],
    });

    await meet.leave(page);
    expect(await meet.state(page)).toBe('ended');
  });

  it('scrapes the chat, opens the panel and maps the own messages to the bot name', async () => {
    const page = await open();
    await meet.join(
      page,
      'https://meet.google.com/abc-defg-hij?lobby=100&chat=Alice|0|Agenda https://example.com/a.;Bob|50|Thanks',
      options(),
    );
    await expect
      .poll(async () => (await meet.scrapeChat(page, 'OpenMinutes Notetaker')).length)
      .toBe(2);
    expect(await page.locator('#chat').isVisible()).toBe(true);

    await meet.sendChatMessage(page, 'Hello from OpenMinutes');
    const messages = await meet.scrapeChat(page, 'OpenMinutes Notetaker');
    expect(messages.map((m) => [m.sender, m.text, m.links])).toEqual([
      ['Alice', 'Agenda https://example.com/a.', ['https://example.com/a']],
      ['Bob', 'Thanks', []],
      ['OpenMinutes Notetaker', 'Hello from OpenMinutes', []],
    ]);
  });

  it('keeps the camera on and sends a chat message when asked to', async () => {
    const page = await open();
    await meet.join(page, 'https://meet.google.com/abc-defg-hij?lobby=100', {
      ...options(),
      cameraOn: true,
    });
    expect(await page.locator('body').getAttribute('data-camera')).toBeNull();

    await meet.sendChatMessage(page, 'Hello from OpenMinutes');
    await expect
      .poll(() => page.locator('#chat-log [data-own]').allTextContents())
      .toEqual(['Hello from OpenMinutes']);
    await meet.sendChatMessage(page, 'Second message');
    await expect
      .poll(() => page.locator('#chat-log [data-own]').allTextContents())
      .toEqual(['Hello from OpenMinutes', 'Second message']);
  });

  it('follows the active speaker, joins and leaves on the fake page', async () => {
    const page = await open();
    const url =
      'https://meet.google.com/abc-defg-hij?lobby=100&speakers=Alice:0-60000&joins=Carol:0&leaves=Bob:0';
    await meet.join(page, url, options());
    await expect(meet.scrapeRoom(page, 'OpenMinutes Notetaker')).resolves.toMatchObject({
      participants: ['Alice', 'Carol', 'OpenMinutes Notetaker'],
      speaking: ['Alice'],
    });
  });

  it('lists any number of guests and reports those who speak at once', async () => {
    const page = await open();
    const guests = 'others=Alice,Bob,Carol,Dave,Erin&speakers=Carol:0-60000,Erin:0-60000';
    await meet.join(page, `https://meet.google.com/abc-defg-hij?lobby=100&${guests}`, options());
    await expect(meet.scrapeRoom(page, 'OpenMinutes Notetaker')).resolves.toMatchObject({
      participants: ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'OpenMinutes Notetaker'],
      speaking: ['Carol', 'Erin'],
    });
  });

  it('reports a denied request', async () => {
    const page = await open();
    const attempt = meet.join(
      page,
      'https://meet.google.com/abc-defg-hij?lobby=300&deny=1',
      options(),
    );
    await expect(attempt).rejects.toMatchObject({ reason: 'denied' });
  });

  it('reports a blocked guest', async () => {
    const page = await open();
    const attempt = meet.join(page, 'https://meet.google.com/abc-defg-hij?blocked=1', options());
    await expect(attempt).rejects.toBeInstanceOf(JoinError);
  });

  it('reports a guest that Meet refuses after the join request', async () => {
    const page = await open();
    const attempt = meet.join(
      page,
      'https://meet.google.com/abc-defg-hij?blockedAfterJoin=1',
      options(),
    );
    await expect(attempt).rejects.toMatchObject({ reason: 'blocked' });
  });

  it('times out in the lobby', async () => {
    const page = await open();
    const attempt = meet.join(page, 'https://meet.google.com/abc-defg-hij?lobby=60000', {
      ...options(),
      lobbyTimeoutMs: 1_500,
    });
    await expect(attempt).rejects.toMatchObject({ reason: 'lobby_timeout' });
  });

  describe('signed in with a Google account', () => {
    const signedIn = () => ({ ...options(), signedIn: true });

    it('joins under the account name after the lobby', async () => {
      const page = await open(true);
      let lobbySeen = false;
      await meet.join(page, 'https://meet.google.com/abc-defg-hij?lobby=300', {
        ...signedIn(),
        onLobby: () => {
          lobbySeen = true;
        },
      });

      expect(lobbySeen).toBe(true);
      expect(await page.locator('input').count()).toBe(0);
      expect(await page.locator('body').getAttribute('data-mic')).toBe('off');
      await expect(meet.scrapeRoom(page, 'OpenMinutes Notetaker')).resolves.toMatchObject({
        participants: ['Alice', 'Bob', 'Bot Account'],
        speaking: [],
      });
    });

    it('does not count the lobby as joined, although Leave call is already visible', async () => {
      const page = await open(true);
      const joining = meet.join(page, 'https://meet.google.com/abc-defg-hij?lobby=1200', {
        ...signedIn(),
      });
      await expect
        .poll(() =>
          page.getByText('Please wait until a meeting host brings you into the call').isVisible(),
        )
        .toBe(true);
      expect(await page.locator('button[aria-label="Leave call"]').isVisible()).toBe(true);
      let settled = false;
      void joining.then(() => (settled = true));
      await page.waitForTimeout(400);
      expect(settled).toBe(false);
      await joining;
      expect(await page.locator('[data-participant-id]').count()).toBeGreaterThan(0);
    });

    it('joins straight in when the host admits the account automatically', async () => {
      const page = await open(true);
      let lobbySeen = false;
      await meet.join(page, 'https://meet.google.com/abc-defg-hij?direct=1', {
        ...signedIn(),
        onLobby: () => {
          lobbySeen = true;
        },
      });
      expect(await meet.state(page)).toBe('active');
      expect(lobbySeen).toBe(false);
    });

    it('is let in where signed-out guests are refused', async () => {
      const url = 'https://meet.google.com/abc-defg-hij?lobby=100&signedInOnly=1';
      await expect(meet.join(await open(), url, options())).rejects.toMatchObject({
        reason: 'blocked',
      });
      await meet.join(await open(true), url, signedIn());
    });

    it('reports an expired session when Meet shows the guest page', async () => {
      const attempt = meet.join(
        await open(),
        'https://meet.google.com/abc-defg-hij?lobby=100',
        signedIn(),
      );
      await expect(attempt).rejects.toMatchObject({ reason: 'session_expired' });
    });

    it('reports an expired session when Meet sends the browser to the sign-in page', async () => {
      const page = await open(true);
      await page
        .context()
        .route('https://accounts.google.com/**', (route) =>
          route.fulfill({ contentType: 'text/html', body: '<h1>Sign in</h1>' }),
        );
      await page.context().route('https://meet.google.com/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<script>location.href = "https://accounts.google.com/signin"</script>',
        }),
      );
      const attempt = meet.join(page, 'https://meet.google.com/abc-defg-hij', {
        ...signedIn(),
        lobbyTimeoutMs: 500,
      });
      await expect(attempt).rejects.toMatchObject({ reason: 'session_expired' });
    });
  });
});
