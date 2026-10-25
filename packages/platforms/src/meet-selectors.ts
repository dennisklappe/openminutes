import type { Page } from 'playwright-core';

export const MEET_SELECTORS_VERSION = '2026-10-22';

export const meetLocators = (page: Page) => ({
  nameInput: page.locator('input[aria-label="Your name"]'),
  micOn: page.locator('[role="button"][aria-label^="Turn off microphone"]'),
  micOff: page.locator('[role="button"][aria-label^="Turn on microphone"]'),
  cameraOn: page.locator('[role="button"][aria-label^="Turn off camera"]'),
  joinButton: page.locator('button', { hasText: /^(Ask to join|Join now)$/ }),
  leaveButton: page.locator('button[aria-label="Leave call"]'),
  lobbyNotice: page.getByText(
    /Asking to be let in|Someone will let you in soon|Please wait until a meeting host brings you into the call/,
  ),
  deniedNotice: page.getByText(/denied your request|removed you from the call/),
  blockedNotice: page.getByText(/can't join this (video )?call|Check your meeting code/i),
  chatButton: page.locator('button[aria-label="Chat with everyone"]'),
  chatClosedButton: page.locator('button[aria-label="Chat with everyone"][aria-pressed="false"]'),
  chatInput: page.locator('textarea[aria-label="Send a message"]'),
  chatSend: page.locator('button[aria-label="Send a message"]'),
});
