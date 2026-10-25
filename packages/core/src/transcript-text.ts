import { asc, eq, participants, transcriptSegments, type Database } from '@openminutes/db';
import { formatTranscript } from '@openminutes/providers';

export async function loadTranscriptText(db: Database, meetingId: string): Promise<string> {
  const segments = await db
    .select({
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      text: transcriptSegments.text,
      speaker: participants.displayName,
    })
    .from(transcriptSegments)
    .leftJoin(participants, eq(participants.id, transcriptSegments.participantId))
    .where(eq(transcriptSegments.meetingId, meetingId))
    .orderBy(asc(transcriptSegments.startMs));
  return formatTranscript(
    segments.map(({ speaker, ...segment }) => (speaker ? { ...segment, speaker } : segment)),
  );
}
