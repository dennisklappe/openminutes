import { and, eq, gt, isNull, meetings, or, skippedSeries, type Database } from '@openminutes/db';
import type { JobSender } from './queue.js';

export type SkipResult = 'skipped' | 'not_found' | 'not_skippable';
export type RejoinResult = 'rescheduled' | 'not_found' | 'not_skipped' | 'already_started';

export async function skipMeeting(db: Database, meetingId: string): Promise<SkipResult> {
  const updated = await db
    .update(meetings)
    .set({ status: 'skipped', error: null })
    .where(and(eq(meetings.id, meetingId), eq(meetings.status, 'scheduled')))
    .returning({ id: meetings.id });
  if (updated.length > 0) return 'skipped';
  const [existing] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  return existing ? 'not_skippable' : 'not_found';
}

export async function rejoinMeeting(
  deps: { db: Database; queue: JobSender; now?: () => Date },
  meetingId: string,
): Promise<RejoinResult> {
  const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) return 'not_found';
  if (meeting.status !== 'skipped') return 'not_skipped';
  const now = (deps.now ?? (() => new Date()))();
  if (meeting.scheduledStart && meeting.scheduledStart <= now) return 'already_started';

  const updated = await deps.db
    .update(meetings)
    .set({ status: 'scheduled', error: null })
    .where(and(eq(meetings.id, meetingId), eq(meetings.status, 'skipped')))
    .returning({ id: meetings.id });
  if (updated.length === 0) return 'not_skipped';
  await deps.queue.send('meeting.schedule', { meetingId });
  return 'rescheduled';
}

export type SeriesResult = 'changed' | 'not_found' | 'no_series';

const upcoming = (now: Date) =>
  or(isNull(meetings.scheduledStart), gt(meetings.scheduledStart, now));

/** Skips this meeting and every scheduled occurrence of its series, and keeps skipping new ones the calendar adds. */
export async function skipSeries(
  deps: { db: Database; now?: () => Date },
  meetingId: string,
): Promise<SeriesResult> {
  const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) return 'not_found';
  if (!meeting.seriesKey) return 'no_series';
  const now = (deps.now ?? (() => new Date()))();
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(skippedSeries)
      .values({ seriesKey: meeting.seriesKey ?? '', title: meeting.title })
      .onConflictDoNothing();
    await tx
      .update(meetings)
      .set({ status: 'skipped', error: null })
      .where(
        and(
          eq(meetings.seriesKey, meeting.seriesKey ?? ''),
          eq(meetings.status, 'scheduled'),
          upcoming(now),
        ),
      );
  });
  return 'changed';
}

/** Stops skipping a series and schedules its skipped occurrences that have not started. */
export async function rejoinSeries(
  deps: { db: Database; queue: JobSender; now?: () => Date },
  skippedSeriesId: string,
): Promise<SeriesResult> {
  const [series] = await deps.db
    .select()
    .from(skippedSeries)
    .where(eq(skippedSeries.id, skippedSeriesId));
  if (!series) return 'not_found';
  const now = (deps.now ?? (() => new Date()))();
  const revived = await deps.db.transaction(async (tx) => {
    await tx.delete(skippedSeries).where(eq(skippedSeries.id, series.id));
    return tx
      .update(meetings)
      .set({ status: 'scheduled', error: null })
      .where(
        and(
          eq(meetings.seriesKey, series.seriesKey),
          eq(meetings.status, 'skipped'),
          upcoming(now),
        ),
      )
      .returning({ id: meetings.id });
  });
  for (const { id } of revived) await deps.queue.send('meeting.schedule', { meetingId: id });
  return 'changed';
}
