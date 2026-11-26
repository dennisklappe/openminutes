import { z } from 'zod';
import type { BotAccountProvider } from './bot-session-store.js';
import { isValidTotpSecret } from './totp.js';
import type { SettingsStore } from './settings.js';

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  totpSecret: z.string().optional(),
});

export type BotCredentials = z.infer<typeof credentialsSchema>;

export interface BotCredentialsInfo {
  email: string;
  hasPassword: boolean;
  hasTotp: boolean;
}

export class InvalidBotCredentialsError extends Error {}

const CREDENTIALS_KEY = {
  google: 'bot.google_credentials',
  microsoft: 'bot.microsoft_credentials',
} as const satisfies Record<BotAccountProvider, string>;

export async function loadBotCredentials(
  provider: BotAccountProvider,
  settings: SettingsStore,
): Promise<BotCredentials | undefined> {
  const stored = await settings.get(CREDENTIALS_KEY[provider]);
  return stored === undefined ? undefined : credentialsSchema.parse(JSON.parse(stored));
}

export async function loadBotCredentialsInfo(
  provider: BotAccountProvider,
  settings: SettingsStore,
): Promise<BotCredentialsInfo | undefined> {
  const credentials = await loadBotCredentials(provider, settings);
  return (
    credentials && {
      email: credentials.email,
      hasPassword: true,
      hasTotp: credentials.totpSecret !== undefined,
    }
  );
}

/**
 * Saves the credentials encrypted (the keys are secret settings). A blank password or
 * authenticator secret keeps the stored one when the email is unchanged.
 */
export async function saveBotCredentials(
  provider: BotAccountProvider,
  settings: SettingsStore,
  input: { email: string; password?: string | undefined; totpSecret?: string | undefined },
): Promise<void> {
  const current = await loadBotCredentials(provider, settings);
  const keep = current?.email === input.email.trim() ? current : undefined;
  const totpSecret = input.totpSecret?.trim() || keep?.totpSecret;
  if (totpSecret !== undefined && !isValidTotpSecret(totpSecret)) {
    throw new InvalidBotCredentialsError('The authenticator secret is not valid');
  }
  const parsed = credentialsSchema.safeParse({
    email: input.email.trim(),
    password: input.password || keep?.password,
    ...(totpSecret !== undefined && { totpSecret }),
  });
  if (!parsed.success) {
    throw new InvalidBotCredentialsError('Enter the bot account email and password');
  }
  await settings.set(CREDENTIALS_KEY[provider], JSON.stringify(parsed.data));
}

export const clearBotCredentials = (provider: BotAccountProvider, settings: SettingsStore) =>
  settings.delete(CREDENTIALS_KEY[provider]);
