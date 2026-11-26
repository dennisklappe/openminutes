import { z } from 'zod';
import {
  botSessionCriticalExpiry,
  loadBotSession,
  type BotAccountProvider,
} from './bot-session-store.js';
import type { SettingsStore } from './settings.js';

export const EXPIRY_WARNING_MS = 72 * 3_600_000;
const ALERT_INTERVAL_MS = 24 * 3_600_000;

/** Keep-alive record, notify flag and alert throttle are kept per provider, so one provider's alert never mutes the other's. */
const KEYS = {
  google: {
    keepAlive: 'bot.google_keepalive',
    notify: 'bot.google_notify',
    alertSentAt: 'bot.google_alert_sent_at',
  },
  microsoft: {
    keepAlive: 'bot.microsoft_keepalive',
    notify: 'bot.microsoft_notify',
    alertSentAt: 'bot.microsoft_alert_sent_at',
  },
} as const satisfies Record<BotAccountProvider, Record<string, string>>;

const keepAliveSchema = z.object({
  at: z.string(),
  status: z.enum(['ok', 'failed', 'needs_attention']),
  detail: z.string().optional(),
});

export type BotKeepAlive = z.infer<typeof keepAliveSchema>;

export async function loadBotKeepAlive(
  provider: BotAccountProvider,
  settings: SettingsStore,
): Promise<BotKeepAlive | undefined> {
  const stored = await settings.get(KEYS[provider].keepAlive);
  const parsed = stored === undefined ? undefined : keepAliveSchema.safeParse(JSON.parse(stored));
  return parsed?.success ? parsed.data : undefined;
}

export async function recordBotKeepAlive(
  provider: BotAccountProvider,
  settings: SettingsStore,
  status: BotKeepAlive['status'],
  detail?: string,
  now = new Date(),
): Promise<void> {
  const record: BotKeepAlive = { at: now.toISOString(), status, ...(detail && { detail }) };
  await settings.set(KEYS[provider].keepAlive, JSON.stringify(record));
}

/** The earliest critical cookie expiry when it is inside the warning window, else undefined. */
export async function botSessionExpiringSoon(
  provider: BotAccountProvider,
  settings: SettingsStore,
  now = new Date(),
): Promise<Date | undefined> {
  const state = await loadBotSession(provider, settings);
  const expiry = state && botSessionCriticalExpiry(provider, state);
  return expiry && expiry.getTime() - now.getTime() <= EXPIRY_WARNING_MS ? expiry : undefined;
}

export const botNotificationsEnabled = async (
  provider: BotAccountProvider,
  settings: SettingsStore,
) => (await settings.get(KEYS[provider].notify)) !== 'false';

export const setBotNotifications = (
  provider: BotAccountProvider,
  settings: SettingsStore,
  notify: boolean,
) => settings.set(KEYS[provider].notify, String(notify));

export async function botAlertDue(
  provider: BotAccountProvider,
  settings: SettingsStore,
  now = new Date(),
): Promise<boolean> {
  const last = Date.parse((await settings.get(KEYS[provider].alertSentAt)) ?? '');
  return Number.isNaN(last) || now.getTime() - last >= ALERT_INTERVAL_MS;
}

export const markBotAlertSent = (
  provider: BotAccountProvider,
  settings: SettingsStore,
  now = new Date(),
) => settings.set(KEYS[provider].alertSentAt, now.toISOString());
