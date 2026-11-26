import {
  botSessionExpiringSoon,
  loadBotSession,
  markBotSessionExpired,
  recordBotKeepAlive,
  refreshBotSession,
  type JobSender,
  type SettingsStore,
} from '@openminutes/core';
import { contextOptions, type LaunchGoogleBrowser } from './google-browser.js';

const TEAMS_URL = 'https://teams.microsoft.com/v2/';
// Teams moves between these two hosts; anything else (the Microsoft sign-in pages) is signed out.
const TEAMS_HOSTS = new Set(['teams.microsoft.com', 'teams.cloud.microsoft']);
const PAGE_TIMEOUT_MS = 45_000;
/** Teams loads first and sends a signed-out visitor to the sign-in page only from its scripts. */
export const SETTLE_MS = 20_000;

interface KeepAliveDeps {
  settings: SettingsStore;
  queue: JobSender;
  launch: LaunchGoogleBrowser;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const alert = (deps: KeepAliveDeps, reason: string) =>
  deps.queue.send('bot.session-alert', { reason, provider: 'microsoft' });

/** Opens Teams with the stored session; stores the refreshed session when still signed in. */
async function visitWithSession(deps: KeepAliveDeps): Promise<boolean> {
  const session = await loadBotSession('microsoft', deps.settings);
  if (!session) return false;
  const browser = await deps.launch();
  try {
    const context = await browser.newContext(contextOptions(session));
    const page = await context.newPage();
    await page.goto(TEAMS_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
    if (!TEAMS_HOSTS.has(new URL(page.url()).hostname)) return false;
    await refreshBotSession(
      'microsoft',
      deps.settings,
      await context.storageState({ indexedDB: true }),
    );
    return true;
  } finally {
    await browser.close();
  }
}

/**
 * Daily visit to Teams with the Microsoft session, so the sliding sign-in cookie stays fresh and
 * an ended session is found before a meeting. Does nothing without a Microsoft session, and
 * signing in again needs a new session file for now (password sign-in comes later, issue #50).
 */
export async function runMicrosoftKeepAlive(deps: KeepAliveDeps): Promise<void> {
  if ((await loadBotSession('microsoft', deps.settings)) === undefined) return;
  try {
    if (await visitWithSession(deps)) {
      await deps.settings.delete('bot.microsoft_session_expired');
      await recordBotKeepAlive('microsoft', deps.settings, 'ok');
      const expiry = await botSessionExpiringSoon('microsoft', deps.settings);
      if (expiry) {
        await alert(deps, `The Microsoft sign-in of the bot ends on ${expiry.toUTCString()}`);
      }
      return;
    }
    await markBotSessionExpired('microsoft', deps.settings);
    const reason = 'Microsoft signed the bot out, import a new session file';
    await recordBotKeepAlive('microsoft', deps.settings, 'failed', reason);
    await alert(deps, reason);
  } catch (error) {
    const reason = `The keep-alive visit failed: ${message(error)}`;
    await recordBotKeepAlive('microsoft', deps.settings, 'failed', reason);
    await alert(deps, reason);
  }
}
