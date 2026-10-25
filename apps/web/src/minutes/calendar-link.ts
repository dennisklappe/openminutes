import {
  addMinutesLink,
  type CalendarContext,
  type CalendarLinkOutcome,
} from '@openminutes/calendar';
import {
  asc,
  calendarAccounts,
  calendars,
  eq,
  meetingCalendarLinks,
  meetingSources,
  type Database,
} from '@openminutes/db';
import type { CalendarLinkDto } from '../dto.js';
import { latestPermanentShare } from './links.js';
import { createShareLink } from './share-routes.js';
import { defaultShareParts } from './config.js';

export interface CalendarLinkDeps {
  calendar: CalendarContext;
  publicUrl: string | undefined;
}

export const CALENDAR_LINK_SETTING = 'minutes.calendar_link';

export const calendarLinkEnabled = async (deps: Pick<CalendarContext, 'settings'>) =>
  (await deps.settings.get(CALENDAR_LINK_SETTING)) === 'true';

async function minutesUrl(deps: CalendarLinkDeps, meetingId: string): Promise<string | undefined> {
  const base = deps.publicUrl?.replace(/\/$/, '');
  if (!base) return undefined;
  const { db, settings } = deps.calendar;
  const share =
    (await latestPermanentShare(db, meetingId)) ??
    (await createShareLink(db, meetingId, {
      ...(await defaultShareParts(settings)),
      expiresInDays: null,
    }));
  return `${base}/s/${share.token}`;
}

const loadSources = (db: Database, meetingId: string) =>
  db
    .select({
      sourceId: meetingSources.id,
      eventId: meetingSources.calendarEventId,
      calendarExternalId: calendars.externalId,
      calendarName: calendars.name,
      accountId: calendarAccounts.id,
      accountEmail: calendarAccounts.accountEmail,
    })
    .from(meetingSources)
    .innerJoin(calendars, eq(calendars.id, meetingSources.calendarId))
    .innerJoin(calendarAccounts, eq(calendarAccounts.id, calendars.accountId))
    .where(eq(meetingSources.meetingId, meetingId))
    .orderBy(asc(calendarAccounts.accountEmail), asc(calendars.name));

async function record(
  db: Database,
  meetingId: string,
  sourceId: string,
  url: string | undefined,
  outcome: CalendarLinkOutcome,
): Promise<void> {
  const values = {
    status: outcome.status,
    url: outcome.status === 'added' ? (url ?? null) : null,
    error: outcome.status === 'added' ? null : outcome.error,
    updatedAt: new Date(),
  };
  await db
    .insert(meetingCalendarLinks)
    .values({ meetingId, sourceId, ...values })
    .onConflictDoUpdate({ target: meetingCalendarLinks.sourceId, set: values });
}

/**
 * Puts the minutes link into every calendar event of the meeting. Throws when a failure is worth
 * retrying so the job queue tries again with backoff.
 */
export async function runCalendarLink(
  deps: CalendarLinkDeps,
  meetingId: string,
  force = false,
): Promise<void> {
  const { db } = deps.calendar;
  const [sources, url, existing] = await Promise.all([
    loadSources(db, meetingId),
    minutesUrl(deps, meetingId),
    db.select().from(meetingCalendarLinks).where(eq(meetingCalendarLinks.meetingId, meetingId)),
  ]);
  let retry: string | undefined;
  for (const source of sources) {
    const done = existing.find((row) => row.sourceId === source.sourceId);
    if (!force && done?.status === 'added' && done.url === url) continue;
    const outcome: CalendarLinkOutcome = url
      ? await addMinutesLink(
          deps.calendar,
          {
            accountId: source.accountId,
            calendarExternalId: source.calendarExternalId,
            eventId: source.eventId,
          },
          url,
        )
      : {
          status: 'failed',
          error: 'Set OPENMINUTES_PUBLIC_URL to put minutes links in calendars',
          retryable: false,
        };
    await record(db, meetingId, source.sourceId, url, outcome);
    if (outcome.status === 'failed' && outcome.retryable) retry = outcome.error;
  }
  if (retry) throw new Error(`Could not add the minutes link to the calendar: ${retry}`);
}

export async function loadCalendarLinks(
  db: Database,
  meetingId: string,
): Promise<CalendarLinkDto[]> {
  const [sources, rows] = await Promise.all([
    loadSources(db, meetingId),
    db.select().from(meetingCalendarLinks).where(eq(meetingCalendarLinks.meetingId, meetingId)),
  ]);
  return sources.map((source) => {
    const row = rows.find((candidate) => candidate.sourceId === source.sourceId);
    return {
      accountEmail: source.accountEmail,
      calendarName: source.calendarName,
      status: row?.status ?? 'pending',
      error: row?.error ?? null,
    };
  });
}
