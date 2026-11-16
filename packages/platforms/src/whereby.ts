import type { Locator, Page } from 'playwright-core';
import { parseMeetingLink } from './meeting-link.js';
import { muteMicrophone, type MicControl, type MicState } from './mic.js';
import { scrapeWherebyChat } from './whereby-chat.js';
import { parseWherebyRoom } from './whereby-dom.js';
import { wherebyLocators, wherebyRoomSelectors } from './whereby-selectors.js';
import {
  JoinError,
  type JoinOptions,
  type MeetingState,
  type Platform,
  type RoomSnapshot,
} from './types.js';

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const STEP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 500;

async function readToggle(toggle: Locator): Promise<MicState> {
  if ((await toggle.count()) === 0) return 'unknown';
  const pressed = await toggle.first().getAttribute('aria-pressed');
  if (pressed === 'true') return 'on';
  return pressed === 'false' ? 'off' : 'unknown';
}

const wherebyMic = (page: Page): MicControl => {
  const toggle = wherebyLocators(page).micToggle.first();
  return {
    state: () => readToggle(toggle),
    toggle: () => toggle.click({ force: true }),
    wait: (ms) => page.waitForTimeout(ms),
  };
};

async function failure(page: Page): Promise<JoinError | undefined> {
  const s = wherebyLocators(page);
  if (await s.deniedNotice.first().isVisible()) {
    return new JoinError('denied', 'The host did not let the bot in');
  }
  if (await s.missingNotice.first().isVisible()) {
    return new JoinError('meeting_ended', 'The Whereby room does not exist');
  }
  if (await s.endedNotice.first().isVisible()) {
    return new JoinError('meeting_ended', 'The meeting has already ended');
  }
  return undefined;
}

/** Walk past the name prompt and the camera and microphone prompts until the pre-join screen. */
async function reachPreJoin(page: Page, options: JoinOptions): Promise<void> {
  const s = wherebyLocators(page);
  const deadline = Date.now() + PAGE_LOAD_TIMEOUT_MS;
  const ready = s.knockButton.or(s.joinButton).or(s.micToggle);
  while (Date.now() < deadline) {
    const error = await failure(page);
    if (error) throw error;
    if (await s.nameInput.isVisible()) {
      await s.nameInput.fill(options.displayName);
      await s.nameContinue.click();
    } else if (await s.noDevicesButton.isVisible()) {
      await s.noDevicesButton.click();
    } else if (await s.requestPermissionsButton.isVisible()) {
      await s.requestPermissionsButton.click();
    } else if (await s.blockedContinueButton.first().isVisible()) {
      await s.blockedContinueButton.first().click();
    } else if (await ready.first().isVisible()) {
      return;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  throw new JoinError('blocked', 'Whereby never showed the pre-join screen');
}

async function inRoom(page: Page): Promise<boolean> {
  const s = wherebyLocators(page);
  return (
    (await s.leaveButton.isVisible()) &&
    !(await s.knockButton.isVisible()) &&
    !(await s.waitingNotice.first().isVisible())
  );
}

export const whereby: Platform = {
  id: 'whereby',
  label: 'Whereby',

  detect: (url) => parseMeetingLink(url)?.platform === 'whereby',

  async join(page: Page, url: string, options: JoinOptions): Promise<void> {
    const s = wherebyLocators(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT_MS });
    await reachPreJoin(page, options);

    if ((await s.micToggle.count()) > 0) await muteMicrophone(wherebyMic(page));
    if (!options.cameraOn && (await readToggle(s.cameraToggle)) === 'on') {
      await s.cameraToggle.first().click({ force: true });
    }
    const enter = s.knockButton.or(s.joinButton).first();
    await enter.waitFor({ timeout: STEP_TIMEOUT_MS });
    await enter.click();

    const deadline = Date.now() + options.lobbyTimeoutMs;
    let announcedLobby = false;
    while (!(await inRoom(page))) {
      const error = await failure(page);
      if (error) throw error;
      if (!announcedLobby && (await s.waitingNotice.first().isVisible())) {
        announcedLobby = true;
        await options.onLobby();
      }
      if (Date.now() > deadline) {
        throw new JoinError('lobby_timeout', 'Nobody let the bot in before the lobby timeout');
      }
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
  },

  async sendChatMessage(page: Page, text: string): Promise<void> {
    const s = wherebyLocators(page);
    if (!(await s.chatInput.isVisible())) await s.chatButton.click();
    await s.chatInput.fill(text);
    await s.chatSend.click();
  },

  muteMicrophone: (page) => muteMicrophone(wherebyMic(page)),

  async leave(page: Page): Promise<void> {
    const { leaveButton } = wherebyLocators(page);
    if (await leaveButton.isVisible()) await leaveButton.click();
  },

  async state(page: Page): Promise<MeetingState> {
    return (await wherebyLocators(page).leaveButton.isVisible()) ? 'active' : 'ended';
  },

  async scrapeRoom(page: Page): Promise<RoomSnapshot> {
    return page.evaluate<RoomSnapshot>(
      `(${parseWherebyRoom.toString()})(document, ${JSON.stringify(wherebyRoomSelectors)})`,
    );
  },

  scrapeChat: scrapeWherebyChat,
};
