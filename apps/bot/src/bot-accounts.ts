import {
  loadBotCredentials,
  loadBotSession,
  loadGoogleCredentials,
  markBotSessionExpired,
  refreshBotSession,
  type BotAccountProvider,
  type BotStorageState,
  type SettingsStore,
} from '@openminutes/core';
import type { LaunchGoogleBrowser } from './google-browser.js';
import { signInWithSavedCredentials } from './google-keepalive.js';
import { signInWithSavedMicrosoftCredentials } from './microsoft-login.js';

export interface SignInDeps {
  settings: SettingsStore;
  launch: LaunchGoogleBrowser;
}

export type SignInOutcome = { ok: true } | { ok: false; reason?: string };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const notSaved: SignInOutcome = { ok: false };

/** The signed-in account a platform joins with, when one is set. */
export interface BotAccount {
  provider: BotAccountProvider;
  /** Teams v2 keeps its tokens in IndexedDB, Meet does not need it. */
  indexedDB: boolean;
  load(settings: SettingsStore): Promise<BotStorageState | undefined>;
  refresh(settings: SettingsStore, state: BotStorageState): Promise<void>;
  markExpired(settings: SettingsStore): Promise<void>;
  /** Signs in again with saved credentials; the reason when there are none or it failed. */
  signIn(deps: SignInDeps): Promise<SignInOutcome>;
}

const account = (
  provider: BotAccountProvider,
  signIn: BotAccount['signIn'] = () => Promise.resolve(notSaved),
): BotAccount => ({
  provider,
  indexedDB: provider === 'microsoft',
  load: (settings) => loadBotSession(provider, settings),
  refresh: (settings, state) => refreshBotSession(provider, settings, state),
  markExpired: (settings) => markBotSessionExpired(provider, settings),
  signIn,
});

const ACCOUNTS: Partial<Record<string, BotAccount>> = {
  meet: account('google', async (deps) => {
    if (!(await loadGoogleCredentials(deps.settings))) return notSaved;
    return signInWithSavedCredentials(deps).catch((error: unknown) => ({
      ok: false as const,
      reason: message(error),
    }));
  }),
  // Teams joins signed in once a Microsoft session is imported or the saved password signed in
  // (issue #50). Without saved credentials an expired session needs a new session file.
  teams: account('microsoft', async (deps) => {
    if (!(await loadBotCredentials('microsoft', deps.settings))) return notSaved;
    return signInWithSavedMicrosoftCredentials(deps).catch((error: unknown) => ({
      ok: false as const,
      reason: message(error),
    }));
  }),
};

export const accountFor = (platformId: string): BotAccount | undefined => ACCOUNTS[platformId];
