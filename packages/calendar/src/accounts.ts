import {
  calendarAccounts,
  calendars,
  eq,
  type CalendarProviderId,
  type JoinRule,
} from '@openminutes/db';
import type { CalendarContext } from './context.js';
import { withdrawCalendars } from './reconcile.js';
import { loadCredentials } from './credentials.js';
import { createPkce } from './oauth.js';
import { sealTokens } from './tokens.js';

export interface AuthorizationStart {
  url: string;
  codeVerifier: string;
}

export class MissingCredentialsError extends Error {
  constructor(provider: CalendarProviderId) {
    super(`Save the ${provider} client ID and secret first`);
    this.name = 'MissingCredentialsError';
  }
}

async function requireCredentials(context: CalendarContext, provider: CalendarProviderId) {
  const credentials = await loadCredentials(context.settings, provider);
  if (!credentials) throw new MissingCredentialsError(provider);
  return credentials;
}

export async function startAuthorization(
  context: CalendarContext,
  provider: CalendarProviderId,
  request: { redirectUri: string; state: string; extraScopes?: string[] },
): Promise<AuthorizationStart> {
  const credentials = await requireCredentials(context, provider);
  const { verifier, challenge } = createPkce();
  const url = context.providers[provider].authorizeUrl(credentials, {
    ...request,
    codeChallenge: challenge,
  });
  return { url, codeVerifier: verifier };
}

export async function completeAuthorization(
  context: CalendarContext,
  provider: CalendarProviderId,
  grant: { code: string; redirectUri: string; codeVerifier: string },
): Promise<string> {
  const credentials = await requireCredentials(context, provider);
  const api = context.providers[provider];
  const tokens = await api.exchangeCode(
    credentials,
    grant.code,
    grant.redirectUri,
    grant.codeVerifier,
  );
  const accountEmail = await api.accountEmail(tokens.accessToken);
  const encryptedTokens = sealTokens(tokens, context.secret);
  const [account] = await context.db
    .insert(calendarAccounts)
    .values({ provider, accountEmail, encryptedTokens })
    .onConflictDoUpdate({
      target: [calendarAccounts.provider, calendarAccounts.accountEmail],
      set: { encryptedTokens, lastError: null },
    })
    .returning({ id: calendarAccounts.id });
  if (!account) throw new Error('Account insert returned no row');
  await context.queue.send('calendar.sync', { accountId: account.id });
  return account.id;
}

export async function disconnectAccount(
  context: CalendarContext,
  accountId: string,
): Promise<void> {
  const rows = await context.db
    .select({ id: calendars.id })
    .from(calendars)
    .where(eq(calendars.accountId, accountId));
  await withdrawCalendars(
    context,
    rows.map((row) => row.id),
  );
  await context.db.delete(calendarAccounts).where(eq(calendarAccounts.id, accountId));
}

export async function setJoinRule(
  context: CalendarContext,
  calendarId: string,
  joinRule: JoinRule,
): Promise<boolean> {
  const [calendar] = await context.db
    .update(calendars)
    .set({ joinRule, syncState: null })
    .where(eq(calendars.id, calendarId))
    .returning({ accountId: calendars.accountId });
  if (!calendar) return false;
  await context.queue.send('calendar.sync', { accountId: calendar.accountId });
  return true;
}
