import {
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

export interface SignInDeps {
  settings: SettingsStore;
  launch: LaunchGoogleBrowser;
}

/** The signed-in account a platform joins with, when one is set. */
export interface BotAccount {
  provider: BotAccountProvider;
  /** Teams v2 keeps its tokens in IndexedDB, Meet does not need it. */
  indexedDB: boolean;
  load(settings: SettingsStore): Promise<BotStorageState | undefined>;
  refresh(settings: SettingsStore, state: BotStorageState): Promise<void>;
  markExpired(settings: SettingsStore): Promise<void>;
  /** Signs in again with saved credentials; false when there are none or it failed. */
  signIn(deps: SignInDeps): Promise<boolean>;
}

const account = (
  provider: BotAccountProvider,
  signIn: BotAccount['signIn'] = () => Promise.resolve(false),
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
    if (!(await loadGoogleCredentials(deps.settings))) return false;
    const outcome = await signInWithSavedCredentials(deps).catch(() => ({ ok: false }));
    return outcome.ok;
  }),
  // Teams joins signed in once a Microsoft session is imported (issue #50). Password sign-in
  // comes later, so an expired Microsoft session needs a new session file.
  teams: account('microsoft'),
};

export const accountFor = (platformId: string): BotAccount | undefined => ACCOUNTS[platformId];
