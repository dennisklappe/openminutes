import { HEARTBEAT_INTERVAL_MS } from '@openminutes/core';
import { activeMeetingStatuses, and, eq, inArray, meetings, type Database } from '@openminutes/db';

/** Writes the heartbeat and reports whether this claim of the meeting is still active. */
export async function beat(
  db: Database,
  meetingId: string,
  claimedAt: Date,
  now = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(meetings)
    .set({ heartbeatAt: now })
    .where(
      and(
        eq(meetings.id, meetingId),
        eq(meetings.claimedAt, claimedAt),
        inArray(meetings.status, activeMeetingStatuses),
      ),
    )
    .returning({ id: meetings.id });
  return rows.length > 0;
}

/** Calls onLost on every tick after the worker closed the meeting from outside, until stopped. */
export function startHeartbeat(
  db: Database,
  meetingId: string,
  claimedAt: Date,
  onLost: () => void,
  intervalMs = HEARTBEAT_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    void beat(db, meetingId, claimedAt).then(
      (alive) => {
        if (!alive) onLost();
      },
      (error: unknown) => {
        console.error(`meeting ${meetingId}: heartbeat failed`, error);
      },
    );
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
}
