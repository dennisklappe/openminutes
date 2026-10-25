import { calendarAccounts, calendars, eq, type CalendarSyncState } from '@openminutes/db';
import { currentTime, type CalendarContext } from './context.js';
import { SyncExpiredError } from './errors.js';
import { applyEvent, cancelMissing, withdrawCalendars } from './reconcile.js';
import { freshAccessToken } from './tokens.js';
import type { RemoteCalendar } from './types.js';

const HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
const RENEW_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

type Account = typeof calendarAccounts.$inferSelect;
type CalendarRow = typeof calendars.$inferSelect;

async function refreshCalendarList(
  context: CalendarContext,
  account: Account,
  accessToken: string,
): Promise<CalendarRow[]> {
  const remote = await context.providers[account.provider].listCalendars(accessToken);
  for (const calendar of remote) {
    await context.db
      .insert(calendars)
      .values({
        accountId: account.id,
        externalId: calendar.externalId,
        name: calendar.name,
        isPrimary: calendar.isPrimary,
      })
      .onConflictDoUpdate({
        target: [calendars.accountId, calendars.externalId],
        set: { name: calendar.name, isPrimary: calendar.isPrimary },
      });
  }
  const rows = await context.db.select().from(calendars).where(eq(calendars.accountId, account.id));
  const known = new Set(remote.map((calendar) => calendar.externalId));
  const gone = rows.filter((row) => !known.has(row.externalId));
  await withdrawCalendars(
    context,
    gone.map((row) => row.id),
  );
  for (const row of gone) await context.db.delete(calendars).where(eq(calendars.id, row.id));
  return rows.filter((row) => known.has(row.externalId));
}

async function syncCalendar(
  context: CalendarContext,
  account: Account,
  accessToken: string,
  calendar: CalendarRow,
): Promise<void> {
  if (calendar.joinRule === 'never') {
    await withdrawCalendars(context, [calendar.id]);
    await context.db
      .update(calendars)
      .set({ syncState: null })
      .where(eq(calendars.id, calendar.id));
    return;
  }

  const now = currentTime(context);
  const remote: RemoteCalendar = {
    externalId: calendar.externalId,
    name: calendar.name,
    isPrimary: calendar.isPrimary,
  };
  const window = { from: now, to: new Date(now.getTime() + HORIZON_MS) };
  const usable: CalendarSyncState | null =
    calendar.syncState &&
    new Date(calendar.syncState.windowEnd).getTime() - now.getTime() > RENEW_MARGIN_MS
      ? calendar.syncState
      : null;
  const provider = context.providers[account.provider];
  const request = { window, accountEmail: account.accountEmail };
  const result = await provider
    .syncEvents(accessToken, remote, { ...request, state: usable })
    .catch((error: unknown) => {
      if (!(error instanceof SyncExpiredError)) throw error;
      return provider.syncEvents(accessToken, remote, { ...request, state: null });
    });

  const scope = {
    id: calendar.id,
    joinRule: calendar.joinRule,
    accountEmail: account.accountEmail,
  };
  for (const event of result.events) await applyEvent(context, scope, event);
  if (result.full)
    await cancelMissing(context, calendar.id, new Set(result.events.map((e) => e.id)));
  await context.db
    .update(calendars)
    .set({ syncState: result.state })
    .where(eq(calendars.id, calendar.id));
}

async function syncAccount(context: CalendarContext, account: Account): Promise<void> {
  try {
    const accessToken = await freshAccessToken(context, account);
    for (const calendar of await refreshCalendarList(context, account, accessToken)) {
      await syncCalendar(context, account, accessToken, calendar);
    }
    await context.db
      .update(calendarAccounts)
      .set({ lastSyncedAt: currentTime(context), lastError: null })
      .where(eq(calendarAccounts.id, account.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await context.db
      .update(calendarAccounts)
      .set({ lastError: message })
      .where(eq(calendarAccounts.id, account.id));
  }
}

export async function syncAccounts(context: CalendarContext, accountId?: string): Promise<void> {
  const accounts = await context.db
    .select()
    .from(calendarAccounts)
    .where(accountId ? eq(calendarAccounts.id, accountId) : undefined);
  for (const account of accounts) await syncAccount(context, account);
}
