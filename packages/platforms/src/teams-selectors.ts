import type { Page } from 'playwright-core';

export const TEAMS_SELECTORS_VERSION = '2026-10-20';

export const teamsRoomSelectors = {
  tile: '[data-stream-type="Video"][data-tid]',
  nameAttribute: 'data-tid',
  speaking: '[data-tid="voice-level-stream-outline"].vdi-frame-occlusion',
};

export type TeamsRoomSelectors = typeof teamsRoomSelectors;

export const teamsLocators = (page: Page) => ({
  launcherJoin: page.locator('[data-tid="joinOnWeb"]'),
  nameInput: page.locator('[data-tid="prejoin-display-name-input"]'),
  micToggle: page.locator('[data-tid="toggle-mute"]'),
  cameraToggle: page.locator('[data-tid="toggle-video"]'),
  joinButton: page.locator('[data-tid="prejoin-join-button"]'),
  hangupButton: page.locator('#hangup-button'),
  chatButton: page.locator('button[aria-label="Chat"]'),
  chatClosedButton: page.locator('button[aria-label="Chat"][aria-pressed="false"]'),
  chatInput: page.locator('[data-tid="ckeditor"]'),
  chatSend: page.locator('[data-tid="newMessageCommands-send"]'),
  lobbyNotice: page.getByText(
    /let you in (soon|shortly|when the meeting starts)|waiting for (people|someone)/i,
  ),
  aloneNotice: page.getByText(/waiting for others to join/i),
  deniedNotice: page.getByText(/denied access to the meeting|declined your request/i),
  endedNotice: page.getByText(/meeting (has )?ended|you('ve| have) left the meeting/i),
  anonymousBlockedNotice: page.getByText(
    /sign in to join|anonymous (users|participants|guests)|only people (in|with) .* can join/i,
  ),
});
