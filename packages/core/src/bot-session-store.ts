import { z } from 'zod';
import type { SettingsStore } from './settings.js';

export const MAX_BOT_SESSION_BYTES = 1024 * 1024;

export type BotAccountProvider = 'google' | 'microsoft';

interface ProviderDescriptor {
  label: string;
  sessionKey: 'bot.google_session' | 'bot.microsoft_session';
  expiredKey: 'bot.google_session_expired' | 'bot.microsoft_session_expired';
  authCookies: ReadonlySet<string>;
  authDomains: readonly string[];
  loginScript: string;
}

export const BOT_ACCOUNT_PROVIDERS: Record<BotAccountProvider, ProviderDescriptor> = {
  google: {
    label: 'Google',
    sessionKey: 'bot.google_session',
    expiredKey: 'bot.google_session_expired',
    authCookies: new Set(['SID', '__Secure-1PSID', '__Secure-3PSID']),
    authDomains: ['google.com'],
    loginScript: 'scripts/google-login.mjs',
  },
  microsoft: {
    label: 'Microsoft',
    sessionKey: 'bot.microsoft_session',
    expiredKey: 'bot.microsoft_session_expired',
    authCookies: new Set(['ESTSAUTHPERSISTENT', 'ESTSAUTH']),
    authDomains: ['login.microsoftonline.com', 'login.live.com'],
    loginScript: 'scripts/microsoft-login.mjs',
  },
};

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
      // Playwright 1.51+ storageState({ indexedDB: true }); Teams v2 keeps tokens there.
      indexedDB: z.array(z.unknown()).optional(),
    }),
  ),
});

export type BotStorageState = z.infer<typeof storageStateSchema>;

export type BotSessionStatus = 'missing' | 'valid' | 'expired';

export interface BotSessionInfo {
  status: BotSessionStatus;
  expiresAt: Date | null;
}

export class InvalidBotSessionError extends Error {}

const isAuthCookie =
  (provider: BotAccountProvider) =>
  (cookie: BotStorageState['cookies'][number]): boolean => {
    const { authCookies, authDomains } = BOT_ACCOUNT_PROVIDERS[provider];
    const domain = cookie.domain.replace(/^\./, '');
    return (
      authCookies.has(cookie.name) &&
      authDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))
    );
  };

export function parseBotSession(provider: BotAccountProvider, text: string): BotStorageState {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidBotSessionError('The file is not valid JSON');
  }
  const parsed = storageStateSchema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidBotSessionError('The file is not a Playwright storage state');
  }
  if (!parsed.data.cookies.some(isAuthCookie(provider))) {
    const { label, loginScript } = BOT_ACCOUNT_PROVIDERS[provider];
    throw new InvalidBotSessionError(
      `The file has no ${label} sign-in cookies, sign in with ${loginScript} first`,
    );
  }
  return parsed.data;
}

/** Earliest expiry of the persistent sign-in cookies, or null when all are session cookies. */
export function botSessionCriticalExpiry(
  provider: BotAccountProvider,
  state: BotStorageState,
): Date | null {
  const persistent = state.cookies
    .filter(isAuthCookie(provider))
    .map((cookie) => cookie.expires)
    .filter((expires) => expires > 0);
  return persistent.length > 0 ? new Date(Math.min(...persistent) * 1000) : null;
}

export function describeBotSession(
  provider: BotAccountProvider,
  state: BotStorageState | undefined,
  markedExpired: boolean,
  now = new Date(),
): BotSessionInfo {
  if (!state) return { status: 'missing', expiresAt: null };
  const lifetimes = state.cookies.filter(isAuthCookie(provider)).map((cookie) => cookie.expires);
  const persistent = lifetimes.filter((expires) => expires > 0);
  const live = lifetimes.some((expires) => expires <= 0 || expires * 1000 > now.getTime());
  const expiresAt = persistent.length > 0 ? new Date(Math.max(...persistent) * 1000) : null;
  return { status: live && !markedExpired ? 'valid' : 'expired', expiresAt };
}

export async function loadBotSession(
  provider: BotAccountProvider,
  settings: SettingsStore,
): Promise<BotStorageState | undefined> {
  const stored = await settings.get(BOT_ACCOUNT_PROVIDERS[provider].sessionKey);
  return stored === undefined ? undefined : parseBotSession(provider, stored);
}

export async function loadBotSessionInfo(
  provider: BotAccountProvider,
  settings: SettingsStore,
): Promise<BotSessionInfo> {
  const [state, marked] = await Promise.all([
    loadBotSession(provider, settings),
    settings.get(BOT_ACCOUNT_PROVIDERS[provider].expiredKey),
  ]);
  return describeBotSession(provider, state, marked === 'true');
}

export async function saveBotSession(
  provider: BotAccountProvider,
  settings: SettingsStore,
  state: BotStorageState,
): Promise<void> {
  const { sessionKey, expiredKey } = BOT_ACCOUNT_PROVIDERS[provider];
  await settings.set(sessionKey, JSON.stringify(state));
  await settings.delete(expiredKey);
}

export async function refreshBotSession(
  provider: BotAccountProvider,
  settings: SettingsStore,
  state: BotStorageState,
): Promise<void> {
  await settings.set(BOT_ACCOUNT_PROVIDERS[provider].sessionKey, JSON.stringify(state));
}

export async function clearBotSession(
  provider: BotAccountProvider,
  settings: SettingsStore,
): Promise<void> {
  const { sessionKey, expiredKey } = BOT_ACCOUNT_PROVIDERS[provider];
  await settings.delete(sessionKey);
  await settings.delete(expiredKey);
}

export async function markBotSessionExpired(
  provider: BotAccountProvider,
  settings: SettingsStore,
): Promise<void> {
  await settings.set(BOT_ACCOUNT_PROVIDERS[provider].expiredKey, 'true');
}
