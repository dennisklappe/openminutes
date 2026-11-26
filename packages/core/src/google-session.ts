import {
  botSessionCriticalExpiry,
  clearBotSession,
  describeBotSession,
  InvalidBotSessionError,
  loadBotSession,
  loadBotSessionInfo,
  markBotSessionExpired,
  MAX_BOT_SESSION_BYTES,
  parseBotSession,
  refreshBotSession,
  saveBotSession,
  type BotSessionInfo,
  type BotSessionStatus,
  type BotStorageState,
} from './bot-session-store.js';
import type { SettingsStore } from './settings.js';

// Google Meet wrappers over the provider-generic bot session store.

export const MAX_GOOGLE_SESSION_BYTES = MAX_BOT_SESSION_BYTES;
export type GoogleStorageState = BotStorageState;
export type GoogleSessionStatus = BotSessionStatus;
export type GoogleSessionInfo = BotSessionInfo;
export { InvalidBotSessionError as InvalidGoogleSessionError };

export const parseGoogleSession = (text: string): GoogleStorageState =>
  parseBotSession('google', text);

export const criticalExpiry = (state: GoogleStorageState): Date | null =>
  botSessionCriticalExpiry('google', state);

export const describeGoogleSession = (
  state: GoogleStorageState | undefined,
  markedExpired: boolean,
  now = new Date(),
): GoogleSessionInfo => describeBotSession('google', state, markedExpired, now);

export const loadGoogleSession = (settings: SettingsStore) => loadBotSession('google', settings);

export const loadGoogleSessionInfo = (settings: SettingsStore) =>
  loadBotSessionInfo('google', settings);

export const saveGoogleSession = (settings: SettingsStore, state: GoogleStorageState) =>
  saveBotSession('google', settings, state);

export const refreshGoogleSession = (settings: SettingsStore, state: GoogleStorageState) =>
  refreshBotSession('google', settings, state);

export const clearGoogleSession = (settings: SettingsStore) => clearBotSession('google', settings);

export const markGoogleSessionExpired = (settings: SettingsStore) =>
  markBotSessionExpired('google', settings);
