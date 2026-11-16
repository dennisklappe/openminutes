import type { Page } from 'playwright-core';

export const WHEREBY_SELECTORS_VERSION = '2026-11-16';

// Whereby ships `jstest-*` classes and `data-testid`s for its own end to end tests. They survive
// releases better than the hashed CSS module classes, so only the audio indicator uses a class prefix.
export const wherebyRoomSelectors = {
  participant: '[data-clientid]',
  nameBanner: '.jstest-displayname',
  audioIndicator: '[class*="_AudioIndicator_"]',
  mutedClass: '_isMuted_',
  speakingOpacity: 0.5,
};

export type WherebyRoomSelectors = typeof wherebyRoomSelectors;

export const wherebyLocators = (page: Page) => ({
  nameInput: page.locator('.jstest-nameprompt input[name="nickname"]'),
  nameContinue: page.locator('.jstest-nameprompt-continue'),
  noDevicesButton: page.locator('.jstest-avpermissions-nodevices-button'),
  requestPermissionsButton: page.locator('.jstest-avpermissions-requestingPermission-button'),
  blockedContinueButton: page.getByRole('button', { name: /continue without (devices|cam)/i }),
  // The pre-join screen has no jstest classes on the toggles: they are the "Mic" and "Cam" buttons in its form.
  micToggle: page
    .locator('.jstest-mute-button')
    .or(page.locator('form button[aria-pressed]').filter({ hasText: /^mic$/i })),
  cameraToggle: page
    .locator('.jstest-toggle-video')
    .or(page.locator('form button[aria-pressed]').filter({ hasText: /^cam$/i })),
  knockButton: page.locator('.jstest-knock-button'),
  joinButton: page
    .locator('button.jstest-join-room-button, form button.jstest-join-button')
    .or(page.getByRole('button', { name: /^join( meeting| room)?$/i })),
  waitingNotice: page.locator('.jstest-knocker-waiting-footer, .jstest-waiting-for-reply-text'),
  deniedNotice: page.locator('.jstest-knocker-rejected-notification'),
  roomLayout: page.locator('[data-testid="RoomLayout"]'),
  leaveButton: page.locator('.jstest-leave-room-button'),
  chatButton: page.locator('.jstest-open-chat-button'),
  chatInput: page.locator('textarea[data-testid="chatmessage-input-field"]'),
  chatSend: page.locator('button[data-testid="chatmessage-send-button"]'),
  endedNotice: page.getByText(/meeting ended|you('|’)ve left the room/i),
  missingNotice: page.getByText(/is nowhere to be found/i),
});
