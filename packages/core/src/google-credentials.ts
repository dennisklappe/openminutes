import { z } from 'zod';
import { isValidTotpSecret } from './totp.js';
import type { SettingsStore } from './settings.js';

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  totpSecret: z.string().optional(),
});

export type GoogleCredentials = z.infer<typeof credentialsSchema>;

export interface GoogleCredentialsInfo {
  email: string;
  hasPassword: boolean;
  hasTotp: boolean;
}

export class InvalidGoogleCredentialsError extends Error {}

export async function loadGoogleCredentials(
  settings: SettingsStore,
): Promise<GoogleCredentials | undefined> {
  const stored = await settings.get('bot.google_credentials');
  return stored === undefined ? undefined : credentialsSchema.parse(JSON.parse(stored));
}

export async function loadGoogleCredentialsInfo(
  settings: SettingsStore,
): Promise<GoogleCredentialsInfo | undefined> {
  const credentials = await loadGoogleCredentials(settings);
  return (
    credentials && {
      email: credentials.email,
      hasPassword: true,
      hasTotp: credentials.totpSecret !== undefined,
    }
  );
}

/**
 * Saves the credentials. A blank password or authenticator secret keeps the stored one when the
 * email is unchanged.
 */
export async function saveGoogleCredentials(
  settings: SettingsStore,
  input: { email: string; password?: string | undefined; totpSecret?: string | undefined },
): Promise<void> {
  const current = await loadGoogleCredentials(settings);
  const keep = current?.email === input.email.trim() ? current : undefined;
  const totpSecret = input.totpSecret?.trim() || keep?.totpSecret;
  if (totpSecret !== undefined && !isValidTotpSecret(totpSecret)) {
    throw new InvalidGoogleCredentialsError('The authenticator secret is not valid');
  }
  const parsed = credentialsSchema.safeParse({
    email: input.email.trim(),
    password: input.password || keep?.password,
    ...(totpSecret !== undefined && { totpSecret }),
  });
  if (!parsed.success) {
    throw new InvalidGoogleCredentialsError('Enter the bot account email and password');
  }
  await settings.set('bot.google_credentials', JSON.stringify(parsed.data));
}

export const clearGoogleCredentials = (settings: SettingsStore) =>
  settings.delete('bot.google_credentials');
