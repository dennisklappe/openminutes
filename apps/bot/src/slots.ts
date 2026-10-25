import { findJoinConflict } from '@openminutes/core';
import {
  activeMeetingStatuses,
  and,
  asc,
  eq,
  inArray,
  meetings,
  meetingSources,
  sql,
  type Database,
} from '@openminutes/db';

const SLOT_LOCK_ID = 7_431_001;

type ClaimResult = 'claimed' | 'full' | 'gone' | 'duplicate';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const minutesSince = (from: Date, now: Date) =>
  Math.max(1, Math.round((now.getTime() - from.getTime()) / 60_000));

/** Frees a slot by sending away the bot that waited longest in a lobby, never one that was admitted. */
async function evictLongestLobby(
  tx: Tx,
  now: Date,
): Promise<{ requeue: string | undefined } | undefined> {
  const [waiting] = await tx
    .select()
    .from(meetings)
    .where(eq(meetings.status, 'in_lobby'))
    .orderBy(asc(sql`coalesce(${meetings.claimedAt}, ${meetings.createdAt})`))
    .limit(1);
  if (!waiting) return undefined;

  const [source] = await tx
    .select({ id: meetingSources.id })
    .from(meetingSources)
    .where(and(eq(meetingSources.meetingId, waiting.id), eq(meetingSources.joinable, true)))
    .limit(1);
  const requeue =
    source !== undefined && waiting.scheduledStart !== null && waiting.scheduledStart > now;
  const minutes = minutesSince(waiting.claimedAt ?? waiting.createdAt, now);
  const note = `Made room for another meeting after waiting ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'} in the lobby`;
  await tx
    .update(meetings)
    .set(
      requeue
        ? { status: 'scheduled', error: `${note}, the bot joins again before it starts` }
        : { status: 'failed', endedAt: now, error: note },
    )
    .where(eq(meetings.id, waiting.id));
  return { requeue: requeue ? waiting.id : undefined };
}

/** Claims a slot for the meeting. Meetings sent away to make room are added to requeued. */
export async function claimSlot(
  db: Database,
  meetingId: string,
  maxConcurrent: number,
  claimedAt: Date = new Date(),
  requeued: string[] = [],
): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SLOT_LOCK_ID})`);
    const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, meetingId));
    if (meeting?.status !== 'scheduled') return 'gone';

    const conflict =
      meeting.joinKey && !meeting.allowDuplicate
        ? await findJoinConflict(tx, meeting.joinKey, { excludeId: meetingId })
        : undefined;
    if (conflict) {
      await tx
        .update(meetings)
        .set({
          status: 'cancelled',
          error: `Skipped, the bot already joined this link as "${conflict.title}"`,
        })
        .where(eq(meetings.id, meetingId));
      return 'duplicate';
    }

    const [active] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(meetings)
      .where(inArray(meetings.status, activeMeetingStatuses));
    if ((active?.count ?? 0) >= maxConcurrent) {
      const evicted = await evictLongestLobby(tx, claimedAt);
      if (!evicted) return 'full';
      if (evicted.requeue) requeued.push(evicted.requeue);
    }
    await tx
      .update(meetings)
      .set({ status: 'joining', error: null, claimedAt, heartbeatAt: claimedAt })
      .where(eq(meetings.id, meetingId));
    return 'claimed';
  });
}

export async function failInterruptedMeetings(db: Database): Promise<string[]> {
  const interrupted = await db
    .update(meetings)
    .set({
      status: 'failed',
      endedAt: sql`coalesce(${meetings.endedAt}, now())`,
      error:
        'The bot stopped while this meeting was in progress. Audio recorded so far is kept, press Transcribe to use it.',
    })
    .where(inArray(meetings.status, activeMeetingStatuses))
    .returning({ id: meetings.id });
  return interrupted.map((meeting) => meeting.id);
}
