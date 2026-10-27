import {
  assignSpeakers,
  isKnownLanguage,
  normalizeLanguage,
  scoreSpeaker,
  shiftToRange,
  type SpeakerSpan,
  type SpeechRange,
} from '@openminutes/core';
import { eq, meetings, transcriptSegments, type Database } from '@openminutes/db';
import type { Segment } from '@openminutes/providers';

export type TranscriptRow = typeof transcriptSegments.$inferInsert;

const INSERT_BATCH_SIZE = 1000;

/**
 * Rows for the aligned segments. The speaker confidence and the candidates are scored against
 * the speaker spans on the unshifted times, `source` says where those spans came from.
 */
export function toTranscriptRows(
  meetingId: string,
  segments: Segment[],
  speakerSpans: SpeakerSpan[],
  range: SpeechRange | null = null,
  source: 'indicator' | 'diarization' = 'indicator',
  meetingLanguage?: string | null,
): TranscriptRow[] {
  const shift = (timeMs: number) => (range ? shiftToRange(timeMs, range) : timeMs);
  // The speech model names one language for the whole recording, so every line gets it, unless a
  // provider names a language for a segment itself. Unknown stays null.
  const meetingLanguageCode = isKnownLanguage(meetingLanguage)
    ? normalizeLanguage(meetingLanguage)
    : null;
  const spans = speakerSpans.toSorted((a, b) => a.startMs - b.startMs);
  return assignSpeakers(segments, speakerSpans).map((segment) => {
    const { confidence, candidates } = scoreSpeaker(segment, spans, source);
    return {
      meetingId,
      participantId: segment.participantId,
      startMs: shift(segment.startMs),
      endMs: shift(segment.endMs),
      text: segment.text,
      language: segment.language ? normalizeLanguage(segment.language) : meetingLanguageCode,
      confidence: segment.confidence ?? null,
      speakerConfidence: confidence,
      speakerSource: segment.participantId ? source : null,
      speakerCandidates: candidates,
    };
  });
}

export async function saveTranscript(
  db: Database,
  meetingId: string,
  rows: TranscriptRow[],
  range: SpeechRange | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(meetings)
      .set({ trimStartMs: range?.startMs ?? null, trimEndMs: range?.endMs ?? null })
      .where(eq(meetings.id, meetingId));
    await tx.delete(transcriptSegments).where(eq(transcriptSegments.meetingId, meetingId));
    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      await tx.insert(transcriptSegments).values(rows.slice(i, i + INSERT_BATCH_SIZE));
    }
  });
}
