import {
  and,
  eq,
  notInArray,
  participants,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import type { SpeechRange } from '@openminutes/core';
import type { TranscriptRow } from '../transcript-store.js';

/** A line a person assigned to a speaker, on the time line of the untrimmed audio. */
export interface Correction {
  name: string;
  startMs: number;
  endMs: number;
}

/** A new line takes over a correction when this much of it lies inside the corrected range. */
const MIN_CORRECTION_OVERLAP = 0.5;

export async function captureCorrections(
  db: Database,
  meetingId: string,
  trimStartMs: number | null,
): Promise<Correction[]> {
  const rows = await db
    .select({
      name: participants.displayName,
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
    })
    .from(transcriptSegments)
    .innerJoin(participants, eq(participants.id, transcriptSegments.participantId))
    .where(
      and(
        eq(transcriptSegments.meetingId, meetingId),
        eq(transcriptSegments.speakerSource, 'user'),
      ),
    )
    .orderBy(transcriptSegments.startMs);
  const offset = trimStartMs ?? 0;
  return rows.map(({ name, startMs, endMs }) => ({
    name,
    startMs: startMs + offset,
    endMs: endMs + offset,
  }));
}

function correctionFor(row: TranscriptRow, offset: number, corrections: readonly Correction[]) {
  const duration = row.endMs - row.startMs;
  const start = row.startMs + offset;
  return corrections.findLast((correction) => {
    const shared =
      Math.min(row.endMs + offset, correction.endMs) - Math.max(start, correction.startMs);
    return duration > 0 ? shared / duration >= MIN_CORRECTION_OVERLAP : shared >= 0;
  });
}

async function participantIds(
  db: Database,
  meetingId: string,
  names: readonly string[],
  staleIds: readonly string[],
): Promise<Map<string, string>> {
  const known = await db
    .select({ id: participants.id, name: participants.displayName })
    .from(participants)
    .where(
      and(
        eq(participants.meetingId, meetingId),
        staleIds.length > 0 ? notInArray(participants.id, [...staleIds]) : undefined,
      ),
    );
  const ids = new Map(known.toReversed().map(({ id, name }) => [name, id]));
  const missing = names.filter((name) => !ids.has(name));
  if (missing.length > 0) {
    const created = await db
      .insert(participants)
      .values(missing.map((displayName) => ({ meetingId, displayName })))
      .returning({ id: participants.id, name: participants.displayName });
    for (const { id, name } of created) ids.set(name, id);
  }
  return ids;
}

/**
 * Puts the corrections of an earlier run on the new rows. A row takes the speaker of the latest
 * correction that covers at least half of it. Speakers are matched by name among the speakers
 * of this run (`staleIds` are the ones about to be removed) and created when missing, so a
 * corrected line never points at a speaker that is deleted afterwards.
 */
export async function applyCorrections(
  db: Database,
  meetingId: string,
  rows: readonly TranscriptRow[],
  corrections: readonly Correction[],
  range: SpeechRange | null,
  staleIds: readonly string[],
): Promise<TranscriptRow[]> {
  if (corrections.length === 0) return [...rows];
  const offset = range?.startMs ?? 0;
  const matches = rows.map((row) => correctionFor(row, offset, corrections));
  const names = [...new Set(matches.flatMap((match) => match?.name ?? []))];
  if (names.length === 0) return [...rows];
  const ids = await participantIds(db, meetingId, names, staleIds);
  return rows.map((row, i) => {
    const participantId = ids.get(matches[i]?.name ?? '');
    if (!participantId) return row;
    return {
      ...row,
      participantId,
      speakerSource: 'user',
      speakerConfidence: 1,
      previousParticipantId:
        row.participantId && row.participantId !== participantId ? row.participantId : null,
    };
  });
}
