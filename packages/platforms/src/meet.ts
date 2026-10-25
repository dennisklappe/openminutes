import type { Locator, Page } from 'playwright-core';
import { scrapeMeetChat } from './meet-chat.js';
import { meetSelectors as domSelectors, parseMeetRoom } from './meet-dom.js';
import { meetLocators } from './meet-selectors.js';
import { parseMeetingLink } from './meeting-link.js';
import { muteMicrophone, type MicControl } from './mic.js';
import {
  JoinError,
  type JoinOptions,
  type MeetingState,
  type Platform,
  type RoomSnapshot,
} from './types.js';

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

async function muteIfOn(button: Locator): Promise<void> {
  if (await button.first().isVisible()) await button.first().click();
}

const meetMic = (page: Page): MicControl => {
  const s = meetLocators(page);
  return {
    state: async () => {
      if (await s.micOff.first().isVisible()) return 'off';
      return (await s.micOn.first().isVisible()) ? 'on' : 'unknown';
    },
    toggle: () => s.micOn.first().click(),
    wait: (ms) => page.waitForTimeout(ms),
  };
};

const isSignInPage = (page: Page) => new URL(page.url()).hostname === 'accounts.google.com';

const signedOut = async (page: Page, nameInput: Locator) =>
  isSignInPage(page) || (await nameInput.isVisible());

async function waitForPrejoin(page: Page, signedIn: boolean): Promise<void> {
  const s = meetLocators(page);
  const prejoin = s.nameInput.or(s.joinButton).or(s.blockedNotice).first();
  const deadline = Date.now() + PAGE_LOAD_TIMEOUT_MS;
  while (!(await prejoin.isVisible())) {
    if (signedIn && isSignInPage(page)) throw sessionExpired();
    if (Date.now() > deadline) throw new Error('The Meet join page did not load');
    await page.waitForTimeout(POLL_INTERVAL_MS / 2);
  }
}

const sessionExpired = () =>
  new JoinError(
    'session_expired',
    'The Google session of the bot expired, sign in again under Settings, Google Meet sign-in',
  );

export const meet: Platform = {
  id: 'meet',
  label: 'Google Meet',

  detect: (url) => parseMeetingLink(url)?.platform === 'meet',

  async join(page: Page, url: string, options: JoinOptions): Promise<void> {
    const s = meetLocators(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT_MS });
    await waitForPrejoin(page, options.signedIn === true);
    if (options.signedIn && (await signedOut(page, s.nameInput))) throw sessionExpired();
    if (await s.blockedNotice.isVisible()) {
      throw new JoinError('blocked', 'Google Meet does not allow this guest to join');
    }

    if (!options.signedIn) await s.nameInput.fill(options.displayName);
    await muteMicrophone(meetMic(page));
    if (!options.cameraOn) await muteIfOn(s.cameraOn);
    await s.joinButton.first().click();

    const deadline = Date.now() + options.lobbyTimeoutMs;
    let announcedLobby = false;
    // A signed-in bot sees the Leave call button while it waits in the lobby, so the button alone
    // does not prove the host let it in.
    while (!(await s.leaveButton.isVisible()) || (await s.lobbyNotice.isVisible())) {
      if (options.signedIn && (await signedOut(page, s.nameInput))) throw sessionExpired();
      if (await s.deniedNotice.isVisible()) {
        throw new JoinError('denied', 'The host denied the request to join');
      }
      if (await s.blockedNotice.isVisible()) {
        throw new JoinError('blocked', 'Google Meet refused the request to join');
      }
      if (!announcedLobby && (await s.lobbyNotice.isVisible())) {
        announcedLobby = true;
        await options.onLobby();
      }
      if (Date.now() > deadline) {
        throw new JoinError('lobby_timeout', 'Nobody admitted the bot before the lobby timeout');
      }
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
  },

  async sendChatMessage(page: Page, text: string): Promise<void> {
    const s = meetLocators(page);
    if (!(await s.chatInput.isVisible())) await s.chatButton.click();
    await s.chatInput.fill(text);
    await s.chatSend.click();
  },

  muteMicrophone: (page) => muteMicrophone(meetMic(page)),

  async leave(page: Page): Promise<void> {
    const { leaveButton } = meetLocators(page);
    if (await leaveButton.isVisible()) await leaveButton.click();
  },

  async state(page: Page): Promise<MeetingState> {
    return (await meetLocators(page).leaveButton.isVisible()) ? 'active' : 'ended';
  },

  scrapeRoom(page: Page, selfName: string): Promise<RoomSnapshot> {
    return page.evaluate<RoomSnapshot>(
      `(${parseMeetRoom.toString()})(document, ${JSON.stringify(domSelectors)}, ${JSON.stringify(selfName)})`,
    );
  },

  scrapeChat: scrapeMeetChat,
};
