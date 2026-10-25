import { decryptSecret, encryptSecret } from '@openminutes/core';
import { calendarAccounts, eq } from '@openminutes/db';
import { currentTime, type CalendarContext } from './context.js';
import { loadCredentials } from './credentials.js';
import type { TokenSet } from './types.js';

const REFRESH_MARGIN_MS = 60_000;

export const sealTokens = (tokens: TokenSet, secret: string) =>
  encryptSecret(JSON.stringify(tokens), secret);

export const openTokens = (sealed: string, secret: string) =>
  JSON.parse(decryptSecret(sealed, secret)) as TokenSet;

export async function freshAccessToken(
  context: CalendarContext,
  account: typeof calendarAccounts.$inferSelect,
): Promise<string> {
  const tokens = openTokens(account.encryptedTokens, context.secret);
  if (tokens.expiresAt - REFRESH_MARGIN_MS > currentTime(context).getTime()) {
    return tokens.accessToken;
  }
  const credentials = await loadCredentials(context.settings, account.provider);
  if (!credentials) throw new Error(`The ${account.provider} client credentials are not set`);
  const refreshed = await context.providers[account.provider].refresh(
    credentials,
    tokens.refreshToken,
  );
  await context.db
    .update(calendarAccounts)
    .set({
      encryptedTokens: sealTokens(
        { ...refreshed, ...(!refreshed.scope && tokens.scope && { scope: tokens.scope }) },
        context.secret,
      ),
    })
    .where(eq(calendarAccounts.id, account.id));
  return refreshed.accessToken;
}
