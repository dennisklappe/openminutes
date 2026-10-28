import { joinKey } from '@openminutes/core';
import {
  and,
  asc,
  eq,
  inArray,
  meetings,
  meetingSources,
  notInArray,
  skippedSeries,
  sql,
  type CalendarInvitee,
  type Database,
  type JoinRule,
} from '@openminutes/db';
import { currentTime, type CalendarContext } from './context.js';
import { shouldJoin, type JoinableEvent } from './rules.js';
import type { CalendarEvent } from './types.js';

interface CalendarScope {
  id: string;
  joinRule: JoinRule;
  accountEmail: string;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type MeetingRow = typeof meetings.$inferSelect;

/** Held while calendar events are placed, so linking a recording to an event waits for it. */
export const RECONCILE_LOCK_ID = 7_431_002;
const EDITABLE: readonly MeetingRow['status'][] = ['scheduled', 'cancelled', 'skipped'];

const isEditable = (meeting: MeetingRow) => EDITABLE.includes(meeting.status);

function detailsOf(event: JoinableEvent) {
  return {
    title: event.title,
    platform: event.link.platform,
    joinUrl: event.link.url,
    joinKey: joinKey(event.link.url),
    scheduledStart: event.start,
    seriesKey: event.seriesKey,
    location: event.location,
    invitees: event.invitees,
  };
}

const inviteeSignature = (invitees: readonly CalendarInvitee[] | null) =>
  JSON.stringify(invitees?.map((i) => [i.email, i.name, i.declined]));

function withoutEditedTitle(meeting: MeetingRow, details: ReturnType<typeof detailsOf>) {
  const { title, ...rest } = details;
  return meeting.titleEdited ? rest : { title, ...rest };
}

function differs(meeting: MeetingRow, details: ReturnType<typeof detailsOf>): boolean {
  return (
    (!meeting.titleEdited && meeting.title !== details.title) ||
    meeting.joinUrl !== details.joinUrl ||
    meeting.joinKey !== details.joinKey ||
    meeting.seriesKey !== details.seriesKey ||
    meeting.scheduledStart?.getTime() !== details.scheduledStart.getTime() ||
    meeting.location !== details.location ||
    inviteeSignature(meeting.invitees) !== inviteeSignature(details.invitees)
  );
}

async function transact(
  context: CalendarContext,
  work: (tx: Tx) => Promise<string[]>,
): Promise<void> {
  const toSchedule = await context.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${RECONCILE_LOCK_ID})`);
    return work(tx);
  });
  for (const meetingId of new Set(toSchedule)) {
    await context.queue.send('meeting.schedule', { meetingId });
  }
}

async function getMeeting(tx: Tx, meetingId: string): Promise<MeetingRow | undefined> {
  const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, meetingId));
  return meeting;
}

async function joinableSourceIds(tx: Tx, meetingId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: meetingSources.id })
    .from(meetingSources)
    .where(and(eq(meetingSources.meetingId, meetingId), eq(meetingSources.joinable, true)))
    .orderBy(asc(meetingSources.createdAt), asc(meetingSources.id));
  return rows.map((row) => row.id);
}

async function settle(
  tx: Tx,
  meetingId: string,
  details?: ReturnType<typeof detailsOf>,
): Promise<string[]> {
  const meeting = await getMeeting(tx, meetingId);
  if (!meeting || !isEditable(meeting)) return [];
  const status =
    meeting.status === 'skipped'
      ? 'skipped'
      : (await joinableSourceIds(tx, meetingId)).length > 0
        ? 'scheduled'
        : 'cancelled';
  const detailsChanged = details !== undefined && differs(meeting, details);
  if (status === meeting.status && !detailsChanged) return [];
  await tx
    .update(meetings)
    .set({ status, ...(detailsChanged && withoutEditedTitle(meeting, details)) })
    .where(eq(meetings.id, meetingId));
  return status === 'scheduled' ? [meetingId] : [];
}

async function seriesIsSkipped(tx: Tx, seriesKey: string | null): Promise<boolean> {
  if (!seriesKey) return false;
  const [row] = await tx
    .select({ id: skippedSeries.id })
    .from(skippedSeries)
    .where(eq(skippedSeries.seriesKey, seriesKey));
  return row !== undefined;
}

async function placeMeeting(
  tx: Tx,
  event: JoinableEvent,
  source: typeof meetingSources.$inferSelect | undefined,
  current: MeetingRow | undefined,
): Promise<{ id: string; created: boolean }> {
  const details = detailsOf(event);
  const [existing] = await tx
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.joinKey, details.joinKey),
        eq(meetings.scheduledStart, details.scheduledStart),
      ),
    );
  if (existing) return { id: existing.id, created: false };

  const othersJoinable = current
    ? (await joinableSourceIds(tx, current.id)).filter((id) => id !== source?.id)
    : [];
  if (current && othersJoinable.length === 0) return { id: current.id, created: false };

  const startSkipped =
    current?.status === 'skipped' || (await seriesIsSkipped(tx, details.seriesKey));
  const [created] = await tx
    .insert(meetings)
    .values({ ...details, ...(startSkipped && { status: 'skipped' as const }) })
    .onConflictDoNothing()
    .returning({ id: meetings.id });
  if (!created) throw new Error('Meeting insert conflicted after the lookup found nothing');
  return { id: created.id, created: true };
}

async function placeEvent(
  tx: Tx,
  context: CalendarContext,
  calendar: CalendarScope,
  event: CalendarEvent,
): Promise<string[]> {
  const [source] = await tx
    .select()
    .from(meetingSources)
    .where(
      and(eq(meetingSources.calendarId, calendar.id), eq(meetingSources.calendarEventId, event.id)),
    );
  if (!shouldJoin(calendar.joinRule, event, calendar.accountEmail, currentTime(context))) {
    if (!source) return [];
    await tx
      .update(meetingSources)
      .set({ joinable: false })
      .where(eq(meetingSources.id, source.id));
    return settle(tx, source.meetingId);
  }

  const current = source ? await getMeeting(tx, source.meetingId) : undefined;
  if (current && !isEditable(current)) return [];

  const { id: meetingId, created } = await placeMeeting(tx, event, source, current);
  const [linked] = await tx
    .insert(meetingSources)
    .values({
      meetingId,
      calendarId: calendar.id,
      calendarEventId: event.id,
      joinable: true,
    })
    .onConflictDoUpdate({
      target: [meetingSources.calendarId, meetingSources.calendarEventId],
      set: { meetingId, joinable: true },
    })
    .returning({ id: meetingSources.id });
  const isOwner = (await joinableSourceIds(tx, meetingId))[0] === linked?.id;

  const scheduled = await settle(tx, meetingId, isOwner ? detailsOf(event) : undefined);
  if (created && (await getMeeting(tx, meetingId))?.status === 'scheduled') {
    scheduled.push(meetingId);
  }
  if (current && current.id !== meetingId) {
    if (current.status === 'skipped' && (await joinableSourceIds(tx, current.id)).length === 0) {
      await tx.update(meetings).set({ status: 'cancelled' }).where(eq(meetings.id, current.id));
    }
    scheduled.push(...(await settle(tx, current.id)));
  }
  return scheduled;
}

export async function applyEvent(
  context: CalendarContext,
  calendar: CalendarScope,
  event: CalendarEvent,
): Promise<void> {
  await transact(context, (tx) => placeEvent(tx, context, calendar, event));
}

async function withdraw(tx: Tx, sourceIds: string[], meetingIds: string[]): Promise<string[]> {
  if (sourceIds.length === 0) return [];
  await tx
    .update(meetingSources)
    .set({ joinable: false })
    .where(inArray(meetingSources.id, sourceIds));
  const scheduled: string[] = [];
  for (const meetingId of new Set(meetingIds)) scheduled.push(...(await settle(tx, meetingId)));
  return scheduled;
}

export async function cancelMissing(
  context: CalendarContext,
  calendarId: string,
  seenEventIds: ReadonlySet<string>,
): Promise<void> {
  await transact(context, async (tx) => {
    const missing = await tx
      .select({ id: meetingSources.id, meetingId: meetingSources.meetingId })
      .from(meetingSources)
      .where(
        and(
          eq(meetingSources.calendarId, calendarId),
          eq(meetingSources.joinable, true),
          seenEventIds.size > 0
            ? notInArray(meetingSources.calendarEventId, [...seenEventIds])
            : undefined,
        ),
      );
    return withdraw(
      tx,
      missing.map((row) => row.id),
      missing.map((row) => row.meetingId),
    );
  });
}

export async function withdrawCalendars(
  context: CalendarContext,
  calendarIds: readonly string[],
): Promise<void> {
  if (calendarIds.length === 0) return;
  await transact(context, async (tx) => {
    const sources = await tx
      .select({ id: meetingSources.id, meetingId: meetingSources.meetingId })
      .from(meetingSources)
      .where(
        and(inArray(meetingSources.calendarId, calendarIds), eq(meetingSources.joinable, true)),
      );
    return withdraw(
      tx,
      sources.map((row) => row.id),
      sources.map((row) => row.meetingId),
    );
  });
}
