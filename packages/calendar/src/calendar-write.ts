import { calendarAccounts, eq, type CalendarProviderId } from '@openminutes/db';
import type { CalendarContext } from './context.js';
import { AuthRevokedError, CalendarApiError } from './errors.js';
import { withMinutesLink } from './minutes-block.js';
import { freshAccessToken, openTokens } from './tokens.js';

export const CALENDAR_WRITE_SCOPES: Record<CalendarProviderId, readonly string[]> = {
  google: ['https://www.googleapis.com/auth/calendar.events'],
  microsoft: ['Calendars.ReadWrite'],
};

const shortScope = (scope: string) =>
  scope.toLowerCase().replace(/^https:\/\/graph\.microsoft\.com\//, '');

export function hasCalendarWrite(provider: CalendarProviderId, scope: string | undefined): boolean {
  const granted = new Set((scope ?? '').split(/\s+/).map(shortScope));
  return CALENDAR_WRITE_SCOPES[provider].every((required) => granted.has(shortScope(required)));
}

export const canWriteCalendar = (account: typeof calendarAccounts.$inferSelect, secret: string) =>
  hasCalendarWrite(account.provider, openTokens(account.encryptedTokens, secret).scope);

export interface CalendarLinkTarget {
  accountId: string;
  calendarExternalId: string;
  eventId: string;
}

export type CalendarLinkOutcome =
  | { status: 'added' }
  | { status: 'no_permission' | 'needs_reconnect'; error: string }
  | { status: 'failed'; error: string; retryable: boolean };

const NOT_RETRYABLE = new Set([400, 404, 410]);

/** Sets the minutes link in the description of the original calendar event, without notifying guests. */
export async function addMinutesLink(
  context: CalendarContext,
  target: CalendarLinkTarget,
  url: string,
): Promise<CalendarLinkOutcome> {
  const [account] = await context.db
    .select()
    .from(calendarAccounts)
    .where(eq(calendarAccounts.id, target.accountId));
  if (!account)
    return {
      status: 'failed',
      error: 'The calendar account is no longer connected',
      retryable: false,
    };
  if (!canWriteCalendar(account, context.secret)) {
    return {
      status: 'needs_reconnect',
      error: `${account.accountEmail} has not allowed editing calendar events yet: use Allow calendar links under Settings, Minutes`,
    };
  }
  const api = context.providers[account.provider];
  try {
    const accessToken = await freshAccessToken(context, account);
    const current = await api.readEventBody(accessToken, target.calendarExternalId, target.eventId);
    const next = withMinutesLink(current, url);
    if (next.content !== current.content) {
      await api.writeEventBody(accessToken, target.calendarExternalId, target.eventId, next);
    }
    return { status: 'added' };
  } catch (error) {
    if (error instanceof AuthRevokedError) {
      return { status: 'needs_reconnect', error: error.message };
    }
    if (error instanceof CalendarApiError && error.status === 403) {
      return { status: 'no_permission', error: 'Could not add link to calendar (no permission)' };
    }
    const message = error instanceof Error ? error.message : String(error);
    const retryable = !(error instanceof CalendarApiError && NOT_RETRYABLE.has(error.status));
    return { status: 'failed', error: message, retryable };
  }
}
