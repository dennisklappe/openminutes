import {
  clearBotCredentials,
  InvalidBotCredentialsError,
  loadBotCredentials,
  loadBotCredentialsInfo,
  saveBotCredentials,
  type BotCredentials,
  type BotCredentialsInfo,
} from './bot-credentials.js';
import type { SettingsStore } from './settings.js';

export type GoogleCredentials = BotCredentials;
export type GoogleCredentialsInfo = BotCredentialsInfo;
export { InvalidBotCredentialsError as InvalidGoogleCredentialsError };

export const loadGoogleCredentials = (settings: SettingsStore) =>
  loadBotCredentials('google', settings);

export const loadGoogleCredentialsInfo = (settings: SettingsStore) =>
  loadBotCredentialsInfo('google', settings);

export const saveGoogleCredentials = (
  settings: SettingsStore,
  input: Parameters<typeof saveBotCredentials>[2],
) => saveBotCredentials('google', settings, input);

export const clearGoogleCredentials = (settings: SettingsStore) =>
  clearBotCredentials('google', settings);
