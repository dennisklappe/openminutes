import { halfRanges, isProbablyMixed } from '@openminutes/core';
import { eq, and, inArray, isNull, or, transcriptSegments, type Database } from '@openminutes/db';
import type { Diarizer } from '@openminutes/providers';
import { embedInBatches } from './speaker-review/voice-check.js';

export interface GuardLine {
  startMs: number;
  endMs: number;
}

/**
 * Which of the candidate lines are probably two speakers. Costs two voice prints (one per half)
 * for every candidate of at least GUARD_MIN_LINE_MS, none for the others, sent in batches. The
 * guard fails open: without a voice service or on an error nothing is flagged, so learning goes
 * on as it did before the guard existed. Returns the indices into `lines`.
 */
export async function findProbablyMixed(
  diarizer: Diarizer | undefined,
  audioPath: string,
  lines: readonly GuardLine[],
): Promise<Set<number>> {
  const flagged = new Set<number>();
  if (!diarizer) return flagged;
  try {
    const checked = lines.flatMap((line, index) => {
      const halves = halfRanges(line.startMs, line.endMs);
      return halves ? [{ index, halves }] : [];
    });
    if (checked.length === 0) return flagged;
    const embedded = await embedInBatches(
      diarizer,
      audioPath,
      checked.flatMap(({ halves }) => [halves.first, halves.second]),
    );
    if (!embedded) return flagged;
    checked.forEach(({ index }, n) => {
      if (isProbablyMixed(embedded.embeddings[2 * n], embedded.embeddings[2 * n + 1])) {
        flagged.add(index);
      }
    });
  } catch {
    // Fail open: a guard that cannot run must not stop learning.
  }
  return flagged;
}

/** Marks lines as probably mixed, never overriding a mark a person set. */
export async function markProbablyMixed(db: Database, segmentIds: readonly string[]) {
  if (segmentIds.length === 0) return;
  await db
    .update(transcriptSegments)
    .set({ mixed: 'probable' })
    .where(
      and(
        inArray(transcriptSegments.id, [...segmentIds]),
        or(isNull(transcriptSegments.mixed), eq(transcriptSegments.mixed, 'probable')),
      ),
    );
}
