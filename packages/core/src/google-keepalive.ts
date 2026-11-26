import {
  botAlertDue,
  botNotificationsEnabled,
  botSessionExpiringSoon,
  loadBotKeepAlive,
  markBotAlertSent,
  recordBotKeepAlive,
  type BotKeepAlive,
} from './bot-keepalive.js';
import type { SettingsStore } from './settings.js';

export { EXPIRY_WARNING_MS } from './bot-keepalive.js';

export type GoogleKeepAlive = BotKeepAlive;

export const loadKeepAlive = (settings: SettingsStore) => loadBotKeepAlive('google', settings);

export const recordKeepAlive = (
  settings: SettingsStore,
  status: GoogleKeepAlive['status'],
  detail?: string,
  now = new Date(),
) => recordBotKeepAlive('google', settings, status, detail, now);

/** The earliest critical cookie expiry when it is inside the warning window, else undefined. */
export const expiringSoon = (settings: SettingsStore, now = new Date()) =>
  botSessionExpiringSoon('google', settings, now);

export const notificationsEnabled = (settings: SettingsStore) =>
  botNotificationsEnabled('google', settings);

export const alertDue = (settings: SettingsStore, now = new Date()) =>
  botAlertDue('google', settings, now);

export const markAlertSent = (settings: SettingsStore, now = new Date()) =>
  markBotAlertSent('google', settings, now);
