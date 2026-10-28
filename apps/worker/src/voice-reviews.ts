import {
  agreeThreshold,
  AUTO_MIN_LINE_MS,
  ENV_LINES,
  ENV_MIN_LINE_MS,
  ENV_MIN_LINES,
  ENV_MIN_MS,
  ENV_MISMATCH_SHARE,
  loadVoiceTuning,
  normalizeLanguage,
} from '@openminutes/core';
import {
  eq,
  inArray,
  meetings,
  participants,
  people,
  roomVoices,
  transcriptSegments,
  voiceReviews,
  type Database,
} from '@openminutes/db';
import type { ScoredLine } from './speaker-review/voice-check.js';

/** A card needs at least this many lines to play, else the owner has nothing to judge by. */
const MIN_PLAYABLE = 2;

export interface EnvironmentFinding {
  participantId: string;
  /** The share of the voice's speech that did not match the profile, 0 to 1. */
  mismatch: number;
  /** The lines to play, the longest first. */
  lines: ScoredLine[];
}

/**
 * Voices that do not sound like the profile of the person they are labelled as for most of the
 * meeting: a new microphone, room or headset, or someone else on the same account. A voice
 * needs enough speech first, so a short visit asks nothing. `threshold` is the agree threshold of
 * the person, `clean` says whether a line may be offered as a sample.
 */
export function findEnvironmentChanges(
  scored: readonly ScoredLine[],
  threshold: (participantId: string) => number | undefined,
  clean: (line: ScoredLine) => boolean = () => true,
): EnvironmentFinding[] {
  const byVoice = new Map<string, ScoredLine[]>();
  for (const line of scored) {
    const bar = threshold(line.participantId);
    const own = line.scores.get(line.participantId);
    if (bar === undefined || own === undefined) continue;
    if (line.endMs - line.startMs < ENV_MIN_LINE_MS) continue;
    byVoice.set(line.participantId, [...(byVoice.get(line.participantId) ?? []), line]);
  }
  const found: EnvironmentFinding[] = [];
  for (const [participantId, lines] of byVoice) {
    const bar = threshold(participantId) ?? 0;
    const total = lines.reduce((sum, l) => sum + l.endMs - l.startMs, 0);
    const off = lines
      .filter((l) => (l.scores.get(participantId) ?? 0) < bar)
      .reduce((sum, l) => sum + l.endMs - l.startMs, 0);
    if (lines.length < ENV_MIN_LINES || total < ENV_MIN_MS || off / total < ENV_MISMATCH_SHARE) {
      continue;
    }
    const playable = lines
      .filter((l) => l.endMs - l.startMs >= AUTO_MIN_LINE_MS && clean(l))
      .toSorted((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs) || a.startMs - b.startMs)
      .slice(0, ENV_LINES);
    if (playable.length >= MIN_PLAYABLE) {
      found.push({ participantId, mismatch: off / total, lines: playable });
    }
  }
  return found.toSorted((a, b) => b.mismatch - a.mismatch);
}

type Segment = typeof transcriptSegments.$inferSelect;

/**
 * After a meeting is scored: asks one question per voice that does not match the profile of the
 * person it is labelled as for most of the meeting, also when that profile is ready. Nothing
 * enters any profile until the owner answers. A question that exists, answered or not, is never
 * made again. Returns how many were made. Best effort.
 */
export async function createVoiceReviews(
  db: Database,
  meetingId: string,
  scored: readonly ScoredLine[],
): Promise<number> {
  if (scored.length === 0) return 0;
  try {
    return await ask(db, meetingId, scored);
  } catch (error) {
    console.error(`voice reviews of meeting ${meetingId} failed`, error);
    return 0;
  }
}

async function ask(db: Database, meetingId: string, scored: readonly ScoredLine[]) {
  const [[meeting], seats, tiles, segments, tuning] = await Promise.all([
    db.select({ language: meetings.language }).from(meetings).where(eq(meetings.id, meetingId)),
    db.select().from(participants).where(eq(participants.meetingId, meetingId)),
    db
      .select({ participantId: roomVoices.participantId })
      .from(roomVoices)
      .where(eq(roomVoices.meetingId, meetingId)),
    db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, meetingId)),
    loadVoiceTuning(db),
  ]);
  const personIds = [...new Set(seats.flatMap((p) => (p.personId ? [p.personId] : [])))];
  if (personIds.length === 0) return 0;
  const owners = await db.select().from(people).where(inArray(people.id, personIds));
  const tracked = new Map(owners.filter((p) => p.tracking === 'on').map((p) => [p.id, p]));
  const shared = new Set([
    ...tiles.map((t) => t.participantId),
    ...seats.filter((p) => (p.roomCount ?? 1) > 1).map((p) => p.id),
  ]);
  const seatOf = new Map(seats.map((p) => [p.id, p]));
  const threshold = (participantId: string) => {
    const personId = seatOf.get(participantId)?.personId;
    const owner = personId ? tracked.get(personId) : undefined;
    return owner && !shared.has(participantId) && !seatOf.get(participantId)?.isBot
      ? agreeThreshold(tuning, owner.autoMargin)
      : undefined;
  };
  const segmentOf = (line: ScoredLine): Segment | undefined =>
    segments.find(
      (s) =>
        s.startMs === line.startMs &&
        s.endMs === line.endMs &&
        s.participantId === line.participantId,
    );
  const clean = (line: ScoredLine) => {
    const segment = segmentOf(line);
    return (
      segment !== undefined &&
      !segment.mixed &&
      segment.speakerSource !== 'user' &&
      !segments.some(
        (o) =>
          o.id !== segment.id &&
          o.participantId !== segment.participantId &&
          o.startMs < segment.endMs - 300 &&
          o.endMs > segment.startMs + 300,
      )
    );
  };
  const usable = scored.filter((line) => {
    const segment = segmentOf(line);
    return segment !== undefined && !segment.mixed;
  });
  let made = 0;
  for (const finding of findEnvironmentChanges(usable, threshold, clean)) {
    const personId = seatOf.get(finding.participantId)?.personId;
    if (!personId) continue;
    const own = finding.lines.flatMap((l) => segmentOf(l)?.id ?? []);
    const language = normalizeLanguage(
      segmentOf(finding.lines[0] as ScoredLine)?.language ?? meeting?.language,
    );
    const inserted = await db
      .insert(voiceReviews)
      .values({
        meetingId,
        participantId: finding.participantId,
        personId,
        language,
        mismatch: Math.round(finding.mismatch * 100) / 100,
        sampleSegmentIds: own,
      })
      .onConflictDoNothing()
      .returning({ id: voiceReviews.id });
    made += inserted.length;
  }
  return made;
}
