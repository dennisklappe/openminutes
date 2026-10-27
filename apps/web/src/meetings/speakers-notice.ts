import { eq, meetings, type Database } from '@openminutes/db';

type Writer = Pick<Database, 'update'>;

/**
 * Remembers that a person changed who said a line, so the summary written before may name the
 * wrong people. Only user actions call this: the AI review and reprocessing do not.
 */
export async function markSpeakersChanged(db: Writer, meetingId: string): Promise<void> {
  await db
    .update(meetings)
    .set({ speakersChangedAt: new Date() })
    .where(eq(meetings.id, meetingId));
}

/** Hides the notice until the next speaker change. */
export async function dismissSpeakersNotice(db: Writer, meetingId: string): Promise<void> {
  await db
    .update(meetings)
    .set({ speakersNoticeDismissedAt: new Date() })
    .where(eq(meetings.id, meetingId));
}

/**
 * Whether to tell the owner that speakers changed after the current summary was written, and
 * they did not dismiss that yet.
 */
export function speakersChangedSinceSummary(
  meeting: Pick<typeof meetings.$inferSelect, 'speakersChangedAt' | 'speakersNoticeDismissedAt'>,
  summaryWrittenAt: Date | undefined,
): boolean {
  const { speakersChangedAt, speakersNoticeDismissedAt } = meeting;
  if (!speakersChangedAt || !summaryWrittenAt) return false;
  if (speakersChangedAt <= summaryWrittenAt) return false;
  return !speakersNoticeDismissedAt || speakersNoticeDismissedAt < speakersChangedAt;
}
