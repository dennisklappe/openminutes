import {
  expiringSoon,
  loadGoogleCredentials,
  loadGoogleSession,
  markGoogleSessionExpired,
  recordKeepAlive,
  refreshGoogleSession,
  saveGoogleSession,
  type JobSender,
  type SettingsStore,
} from '@openminutes/core';
import { contextOptions, type LaunchGoogleBrowser } from './google-browser.js';
import { signInToGoogle } from './google-login.js';

const ACCOUNT_URL = 'https://myaccount.google.com/';
const PAGE_TIMEOUT_MS = 45_000;

interface KeepAliveDeps {
  settings: SettingsStore;
  queue: JobSender;
  launch: LaunchGoogleBrowser;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const alert = (deps: KeepAliveDeps, reason: string) =>
  deps.queue.send('bot.session-alert', { reason });

/**
 * Signs in again with the saved credentials in a headless browser and stores the new session.
 * Returns the reason when that is not possible.
 */
export async function signInWithSavedCredentials(
  deps: Pick<KeepAliveDeps, 'settings' | 'launch'>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const credentials = await loadGoogleCredentials(deps.settings);
  if (!credentials) return { ok: false, reason: 'No email and password are saved' };
  const browser = await deps.launch();
  try {
    const context = await browser.newContext(contextOptions());
    const outcome = await signInToGoogle(context, await context.newPage(), credentials);
    if (outcome.ok) await saveGoogleSession(deps.settings, await context.storageState());
    return outcome;
  } finally {
    await browser.close();
  }
}

async function visitWithSession(deps: KeepAliveDeps): Promise<boolean> {
  const session = await loadGoogleSession(deps.settings);
  if (!session) return false;
  const browser = await deps.launch();
  try {
    const context = await browser.newContext(contextOptions(session));
    const page = await context.newPage();
    await page.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    if (new URL(page.url()).hostname === 'accounts.google.com') return false;
    await refreshGoogleSession(deps.settings, await context.storageState());
    return true;
  } finally {
    await browser.close();
  }
}

async function recover(deps: KeepAliveDeps, hadSession: boolean): Promise<void> {
  if (!(await loadGoogleCredentials(deps.settings))) {
    if (hadSession) await markGoogleSessionExpired(deps.settings);
    const reason = 'Google signed the bot out and no password is saved to sign in again';
    await recordKeepAlive(deps.settings, 'failed', reason);
    await alert(deps, reason);
    return;
  }
  const outcome = await signInWithSavedCredentials(deps);
  if (outcome.ok) {
    await recordKeepAlive(deps.settings, 'ok', 'Signed in again with the saved password');
    return;
  }
  if (hadSession) await markGoogleSessionExpired(deps.settings);
  await recordKeepAlive(deps.settings, 'needs_attention', outcome.reason);
  await alert(deps, outcome.reason);
}

export async function runGoogleKeepAlive(deps: KeepAliveDeps): Promise<void> {
  const hadSession = (await loadGoogleSession(deps.settings)) !== undefined;
  if (!hadSession && !(await loadGoogleCredentials(deps.settings))) return;
  try {
    if (hadSession && (await visitWithSession(deps))) {
      await deps.settings.delete('bot.google_session_expired');
      await recordKeepAlive(deps.settings, 'ok');
      const expiry = await expiringSoon(deps.settings);
      if (expiry) {
        await alert(deps, `The Google sign-in of the bot ends on ${expiry.toUTCString()}`);
      }
      return;
    }
    await recover(deps, hadSession);
  } catch (error) {
    const reason = `The keep-alive visit failed: ${message(error)}`;
    await recordKeepAlive(deps.settings, 'failed', reason);
    await alert(deps, reason);
  }
}
