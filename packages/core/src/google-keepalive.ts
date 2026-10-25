import { z } from 'zod';
import { criticalExpiry, loadGoogleSession } from './google-session.js';
import type { SettingsStore } from './settings.js';

export const EXPIRY_WARNING_MS = 72 * 3_600_000;
const ALERT_INTERVAL_MS = 24 * 3_600_000;

const keepAliveSchema = z.object({
  at: z.string(),
  status: z.enum(['ok', 'failed', 'needs_attention']),
  detail: z.string().optional(),
});

export type GoogleKeepAlive = z.infer<typeof keepAliveSchema>;

export async function loadKeepAlive(settings: SettingsStore): Promise<GoogleKeepAlive | undefined> {
  const stored = await settings.get('bot.google_keepalive');
  const parsed = stored === undefined ? undefined : keepAliveSchema.safeParse(JSON.parse(stored));
  return parsed?.success ? parsed.data : undefined;
}

export async function recordKeepAlive(
  settings: SettingsStore,
  status: GoogleKeepAlive['status'],
  detail?: string,
  now = new Date(),
): Promise<void> {
  const record: GoogleKeepAlive = { at: now.toISOString(), status, ...(detail && { detail }) };
  await settings.set('bot.google_keepalive', JSON.stringify(record));
}

/** The earliest critical cookie expiry when it is inside the warning window, else undefined. */
export async function expiringSoon(
  settings: SettingsStore,
  now = new Date(),
): Promise<Date | undefined> {
  const state = await loadGoogleSession(settings);
  const expiry = state && criticalExpiry(state);
  return expiry && expiry.getTime() - now.getTime() <= EXPIRY_WARNING_MS ? expiry : undefined;
}

export const notificationsEnabled = async (settings: SettingsStore) =>
  (await settings.get('bot.google_notify')) !== 'false';

export async function alertDue(settings: SettingsStore, now = new Date()): Promise<boolean> {
  const last = Date.parse((await settings.get('bot.google_alert_sent_at')) ?? '');
  return Number.isNaN(last) || now.getTime() - last >= ALERT_INTERVAL_MS;
}

export const markAlertSent = (settings: SettingsStore, now = new Date()) =>
  settings.set('bot.google_alert_sent_at', now.toISOString());
