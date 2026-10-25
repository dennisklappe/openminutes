import { and, calendarAccounts, eq } from '@openminutes/db';
import type { CalendarContext } from './context.js';
import { freshAccessToken, openTokens } from './tokens.js';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export class GmailAccessError extends Error {
  override readonly name = 'GmailAccessError';
}

const canSend = (row: typeof calendarAccounts.$inferSelect, secret: string) =>
  openTokens(row.encryptedTokens, secret).scope?.split(' ').includes(GMAIL_SEND_SCOPE) === true;

/** Emails of connected Google accounts that granted permission to send mail. */
export async function sendAccounts(context: CalendarContext): Promise<string[]> {
  const rows = await context.db
    .select()
    .from(calendarAccounts)
    .where(eq(calendarAccounts.provider, 'google'));
  return rows.filter((row) => canSend(row, context.secret)).map((row) => row.accountEmail);
}

/** An access token for sending mail as a connected Google account (the only one when omitted). */
export async function gmailAccessToken(
  context: CalendarContext,
  accountEmail?: string,
): Promise<string> {
  const rows = await context.db
    .select()
    .from(calendarAccounts)
    .where(
      accountEmail
        ? and(
            eq(calendarAccounts.provider, 'google'),
            eq(calendarAccounts.accountEmail, accountEmail),
          )
        : eq(calendarAccounts.provider, 'google'),
    );
  const row = rows.find((candidate) => canSend(candidate, context.secret));
  if (!row) {
    throw new GmailAccessError(
      accountEmail
        ? `${accountEmail} has not allowed sending mail, use Allow sending mail in Settings, Email`
        : 'No connected Google account has allowed sending mail',
    );
  }
  return freshAccessToken(context, row);
}
