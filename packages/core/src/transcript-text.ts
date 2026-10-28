import { asc, eq, participants, transcriptSegments, type Database } from '@openminutes/db';
import { formatTranscript } from '@openminutes/providers';
import { isDoubtful } from './speaker-confidence.js';

/** Added to the summary prompt only when the transcript has a speaker followed by a question mark. */
export const GUESSED_SPEAKER_RULE =
  'A speaker name followed by a question mark is a guess. Do not assign action items, decisions or quotes to a guessed speaker; write the item without an owner or say the owner is unclear.';

export interface SummaryTranscript {
  text: string;
  /** At least one line shows its speaker with a question mark. */
  hasGuessedSpeakers: boolean;
}

/**
 * The transcript as the summary model reads it. A line whose speaker is doubtful gets `Name?:`,
 * one character per line and nothing per word. A transcript without doubtful lines is
 * identical to the plain one.
 */
export async function loadSummaryTranscript(
  db: Database,
  meetingId: string,
  markGuesses = true,
): Promise<SummaryTranscript> {
  const segments = await db
    .select({
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      text: transcriptSegments.text,
      speaker: participants.displayName,
      speakerConfidence: transcriptSegments.speakerConfidence,
      speakerSource: transcriptSegments.speakerSource,
      suggestedParticipantId: transcriptSegments.suggestedParticipantId,
      voiceDoubt: transcriptSegments.voiceDoubt,
      byElimination: transcriptSegments.byElimination,
    })
    .from(transcriptSegments)
    .leftJoin(participants, eq(participants.id, transcriptSegments.participantId))
    .where(eq(transcriptSegments.meetingId, meetingId))
    .orderBy(asc(transcriptSegments.startMs));
  let hasGuessedSpeakers = false;
  const lines = segments.map(({ speaker, startMs, endMs, text, ...evidence }) => {
    const segment = { startMs, endMs, text };
    if (!speaker) return segment;
    const guessed = markGuesses && isDoubtful(evidence);
    hasGuessedSpeakers ||= guessed;
    return guessed ? { ...segment, speaker, speakerUncertain: true } : { ...segment, speaker };
  });
  return { text: formatTranscript(lines), hasGuessedSpeakers };
}

export async function loadTranscriptText(db: Database, meetingId: string): Promise<string> {
  return (await loadSummaryTranscript(db, meetingId, false)).text;
}
