import { z } from 'zod';
import type { SettingsStore } from './settings.js';

export const MAX_GOOGLE_SESSION_BYTES = 1024 * 1024;

const AUTH_COOKIES = new Set(['SID', '__Secure-1PSID', '__Secure-3PSID']);

const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  expires: z.number(),
  httpOnly: z.boolean().default(false),
  secure: z.boolean().default(false),
  sameSite: z.enum(['Strict', 'Lax', 'None']).default('Lax'),
});

const storageStateSchema = z.object({
  cookies: z.array(cookieSchema),
  origins: z.array(
    z.object({
      origin: z.string(),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    }),
  ),
});

export type GoogleStorageState = z.infer<typeof storageStateSchema>;

export type GoogleSessionStatus = 'missing' | 'valid' | 'expired';

export interface GoogleSessionInfo {
  status: GoogleSessionStatus;
  expiresAt: Date | null;
}

export class InvalidGoogleSessionError extends Error {}

const isGoogleAuthCookie = (cookie: GoogleStorageState['cookies'][number]) =>
  AUTH_COOKIES.has(cookie.name) && cookie.domain.replace(/^\./, '').endsWith('google.com');

export function parseGoogleSession(text: string): GoogleStorageState {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidGoogleSessionError('The file is not valid JSON');
  }
  const parsed = storageStateSchema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidGoogleSessionError('The file is not a Playwright storage state');
  }
  if (!parsed.data.cookies.some(isGoogleAuthCookie)) {
    throw new InvalidGoogleSessionError(
      'The file has no Google sign-in cookies, sign in with scripts/google-login.mjs first',
    );
  }
  return parsed.data;
}

/** Earliest expiry of the persistent sign-in cookies, or null when all are session cookies. */
export function criticalExpiry(state: GoogleStorageState): Date | null {
  const persistent = state.cookies
    .filter(isGoogleAuthCookie)
    .map((cookie) => cookie.expires)
    .filter((expires) => expires > 0);
  return persistent.length > 0 ? new Date(Math.min(...persistent) * 1000) : null;
}

export function describeGoogleSession(
  state: GoogleStorageState | undefined,
  markedExpired: boolean,
  now = new Date(),
): GoogleSessionInfo {
  if (!state) return { status: 'missing', expiresAt: null };
  const lifetimes = state.cookies.filter(isGoogleAuthCookie).map((cookie) => cookie.expires);
  const persistent = lifetimes.filter((expires) => expires > 0);
  const live = lifetimes.some((expires) => expires <= 0 || expires * 1000 > now.getTime());
  const expiresAt = persistent.length > 0 ? new Date(Math.max(...persistent) * 1000) : null;
  return { status: live && !markedExpired ? 'valid' : 'expired', expiresAt };
}

export async function loadGoogleSession(
  settings: SettingsStore,
): Promise<GoogleStorageState | undefined> {
  const stored = await settings.get('bot.google_session');
  return stored === undefined ? undefined : parseGoogleSession(stored);
}

export async function loadGoogleSessionInfo(settings: SettingsStore): Promise<GoogleSessionInfo> {
  const [state, marked] = await Promise.all([
    loadGoogleSession(settings),
    settings.get('bot.google_session_expired'),
  ]);
  return describeGoogleSession(state, marked === 'true');
}

export async function saveGoogleSession(
  settings: SettingsStore,
  state: GoogleStorageState,
): Promise<void> {
  await settings.set('bot.google_session', JSON.stringify(state));
  await settings.delete('bot.google_session_expired');
}

export async function refreshGoogleSession(
  settings: SettingsStore,
  state: GoogleStorageState,
): Promise<void> {
  await settings.set('bot.google_session', JSON.stringify(state));
}

export async function clearGoogleSession(settings: SettingsStore): Promise<void> {
  await settings.delete('bot.google_session');
  await settings.delete('bot.google_session_expired');
}

export async function markGoogleSessionExpired(settings: SettingsStore): Promise<void> {
  await settings.set('bot.google_session_expired', 'true');
}
