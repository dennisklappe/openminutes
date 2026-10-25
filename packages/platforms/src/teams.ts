import type { Locator, Page } from 'playwright-core';
import { parseMeetingLink } from './meeting-link.js';
import { muteMicrophone, type MicControl, type MicState } from './mic.js';
import { scrapeTeamsChat } from './teams-chat.js';
import { parseTeamsRoom } from './teams-dom.js';
import { teamsLocators, teamsRoomSelectors } from './teams-selectors.js';
import {
  JoinError,
  type JoinOptions,
  type MeetingState,
  type Platform,
  type RoomSnapshot,
} from './types.js';

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
async function switchOff(toggle: Locator): Promise<void> {
  if (await toggle.isChecked()) await toggle.uncheck({ force: true });
}

async function readMic(toggle: Locator): Promise<MicState> {
  if ((await toggle.count()) === 0) return 'unknown';
  if ((await toggle.getAttribute('type')) === 'checkbox') {
    return (await toggle.isChecked()) ? 'on' : 'off';
  }
  const label = (await toggle.getAttribute('aria-label')) ?? (await toggle.getAttribute('title'));
  if (/^unmute/i.test(label ?? '')) return 'off';
  return /^mute/i.test(label ?? '') ? 'on' : 'unknown';
}

const teamsMic = (page: Page): MicControl => {
  const toggle = teamsLocators(page).micToggle.first();
  return {
    state: () => readMic(toggle),
    toggle: () => toggle.click({ force: true }),
    wait: (ms) => page.waitForTimeout(ms),
  };
};

async function failure(page: Page): Promise<JoinError | undefined> {
  const s = teamsLocators(page);
  if (await s.anonymousBlockedNotice.first().isVisible()) {
    return new JoinError('anonymous_blocked', 'This tenant blocks anonymous guests');
  }
  if (await s.deniedNotice.first().isVisible()) {
    return new JoinError('denied', 'The organizer denied the request to join');
  }
  if (await s.endedNotice.first().isVisible()) {
    return new JoinError('meeting_ended', 'The meeting has already ended');
  }
  return undefined;
}

export const teams: Platform = {
  id: 'teams',
  label: 'Microsoft Teams',

  detect: (url) => parseMeetingLink(url)?.platform === 'teams',

  async join(page: Page, url: string, options: JoinOptions): Promise<void> {
    const s = teamsLocators(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT_MS });
    await s.launcherJoin.or(s.nameInput).first().waitFor({ timeout: PAGE_LOAD_TIMEOUT_MS });
    if (await s.launcherJoin.isVisible()) await s.launcherJoin.click();

    await s.nameInput
      .or(s.anonymousBlockedNotice.first())
      .first()
      .waitFor({ timeout: PAGE_LOAD_TIMEOUT_MS });
    const blocked = await failure(page);
    if (blocked && !(await s.nameInput.isVisible())) throw blocked;

    await s.nameInput.fill(options.displayName);
    await muteMicrophone(teamsMic(page));
    if (!options.cameraOn) await switchOff(s.cameraToggle);
    await s.joinButton.click();

    const deadline = Date.now() + options.lobbyTimeoutMs;
    let announcedLobby = false;
    while (!(await s.hangupButton.isVisible())) {
      const error = await failure(page);
      if (error) throw error;
      if (!announcedLobby && (await s.lobbyNotice.first().isVisible())) {
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
    const s = teamsLocators(page);
    if (!(await s.chatInput.isVisible())) await s.chatButton.click();
    await s.chatInput.fill(text);
    await s.chatSend.click();
  },

  muteMicrophone: (page) => muteMicrophone(teamsMic(page)),

  async leave(page: Page): Promise<void> {
    const { hangupButton } = teamsLocators(page);
    if (await hangupButton.isVisible()) await hangupButton.click();
  },

  async state(page: Page): Promise<MeetingState> {
    return (await teamsLocators(page).hangupButton.isVisible()) ? 'active' : 'ended';
  },

  async scrapeRoom(page: Page, selfName: string): Promise<RoomSnapshot> {
    const room = await page.evaluate<RoomSnapshot>(
      `(${parseTeamsRoom.toString()})(document, ${JSON.stringify(teamsRoomSelectors)})`,
    );
    if (room.participants.length > 0) return room;
    const alone = await teamsLocators(page).aloneNotice.first().isVisible();
    return alone ? { participants: [selfName], speaking: [] } : room;
  },

  scrapeChat: scrapeTeamsChat,
};
