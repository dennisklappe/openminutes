import { eq, meetings, transcriptSegments } from '@openminutes/db';
import { loadPeople, type ReviewDeps } from './transcript-review.js';
import { reviewLines } from './review.js';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Runs the speaker review again on the stored transcript of a meeting, without transcribing. The
 * model is used when one is set up, else the plain dialog heuristic. Lines a person corrected are
 * skipped. Problems are written to the meeting and not thrown, a retry would not help.
 */
export async function reviewMeetingSpeakers(deps: ReviewDeps, meetingId: string): Promise<void> {
  const { db } = deps;
  try {
    const rows = await db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId))
      .orderBy(transcriptSegments.startMs, transcriptSegments.id);
    const provider = await deps.createRefiner();
    const review = await reviewLines(provider, rows, await loadPeople(db, meetingId));
    await db.transaction(async (tx) => {
      for (const [i, line] of review.lines.entries()) {
        const before = rows[i];
        if (!before || line === before) continue;
        await tx
          .update(transcriptSegments)
          .set({
            participantId: line.participantId,
            speakerConfidence: line.speakerConfidence,
            speakerSource: line.speakerSource,
            previousParticipantId: line.previousParticipantId,
          })
          .where(eq(transcriptSegments.id, before.id));
      }
      await tx
        .update(meetings)
        .set({
          speakerCheckedAt: new Date(),
          speakerCheckError: review.error,
          ...(provider && review.refined ? { speakersRefined: true } : {}),
        })
        .where(eq(meetings.id, meetingId));
    });
  } catch (error) {
    console.error(`speaker review of meeting ${meetingId} failed`, error);
    await db
      .update(meetings)
      .set({ speakerCheckError: errorMessage(error) })
      .where(eq(meetings.id, meetingId));
  }
}
