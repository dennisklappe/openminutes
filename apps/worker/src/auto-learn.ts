import {
  addVoiceSamples,
  AUTO_MARGIN,
  AUTO_MIN_LINE_MS,
  AUTO_MIN_SCORE,
  AUTO_MIN_TIMING_CONFIDENCE,
  AUTO_PER_MEETING_MS,
  AUTO_RATIO,
  AUTO_SEED_MS,
  isKnownLanguage,
  normalizeLanguage,
} from '@openminutes/core';
import {
  eq,
  inArray,
  meetings,
  participants,
  people,
  transcriptSegments,
  voiceSamples,
  type Database,
} from '@openminutes/db';
import type { Diarizer } from '@openminutes/providers';
import { findProbablyMixed, markProbablyMixed } from './mixed-guard.js';
import type { ScoredLine } from './speaker-review/voice-check.js';

/** What the mixed line guard needs: the audio the lines were scored on and the voice service. */
export interface AutoLearnGuard {
  audioPath: string;
  diarizer: Diarizer | undefined;
}

/** Where a line stands, gathered by `autoLearn` and judged by `isNearCertain`. */
export interface NearCertainInput {
  line: Pick<ScoredLine, 'participantId' | 'timing' | 'scores'>;
  durationMs: number;
  /** speaker_source of the saved line. Only the call's indicator or diarization count. */
  source: string | null;
  /** Another speaker talks over the line. */
  overlapped: boolean;
  /** The voice check doubts the line or an AI review changed or suggested it. */
  disputed: boolean;
  /** The extra margin this person needs after rejected auto samples. */
  extraMargin: number;
}

/**
 * A line is learned by itself only when independent evidence agrees: the speaker indicator (or
 * diarization) says it is this participant and is sure, the voice check scores it high against
 * the profile and clearly ahead of every other voice in the meeting, the line is long enough, has
 * nobody talking over it, and no AI or voice check has touched it.
 */
export function isNearCertain({
  line,
  durationMs,
  source,
  overlapped,
  disputed,
  extraMargin,
}: NearCertainInput): boolean {
  if (source !== 'indicator' && source !== 'diarization') return false;
  if ((line.timing ?? 0) < AUTO_MIN_TIMING_CONFIDENCE) return false;
  if (durationMs < AUTO_MIN_LINE_MS || overlapped || disputed) return false;
  const own = line.scores.get(line.participantId);
  if (own === undefined || own < AUTO_MIN_SCORE) return false;
  const others = [...line.scores].filter(([id]) => id !== line.participantId).map(([, s]) => s);
  return own - Math.max(0, ...others) >= AUTO_MARGIN + extraMargin;
}

/**
 * After a meeting is transcribed and its participants are linked to people: adds the near-certain
 * lines to the voice profile of their speaker as auto samples. Only for tracked people who have
 * a seed of verified speech in the language of the line, never beyond the caps. Best effort.
 */
export async function autoLearn(
  db: Database,
  meetingId: string,
  scored: readonly ScoredLine[],
  enabled: boolean,
  guard?: AutoLearnGuard,
): Promise<number> {
  if (!enabled || scored.length === 0) return 0;
  try {
    return await learnNearCertain(db, meetingId, scored, guard);
  } catch (error) {
    console.error(`automatic voice learning of meeting ${meetingId} failed`, error);
    return 0;
  }
}

async function learnNearCertain(
  db: Database,
  meetingId: string,
  scored: readonly ScoredLine[],
  guard: AutoLearnGuard | undefined,
): Promise<number> {
  const [[meeting], segments, seats] = await Promise.all([
    db.select({ language: meetings.language }).from(meetings).where(eq(meetings.id, meetingId)),
    db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, meetingId)),
    db.select().from(participants).where(eq(participants.meetingId, meetingId)),
  ]);
  const personOf = new Map(seats.flatMap((p) => (p.personId ? [[p.id, p.personId] as const] : [])));
  const ids = [...new Set(personOf.values())];
  if (ids.length === 0) return 0;
  const [owners, samples] = await Promise.all([
    db.select().from(people).where(inArray(people.id, ids)),
    db.select().from(voiceSamples).where(inArray(voiceSamples.personId, ids)),
  ]);
  const tracked = new Map(owners.filter((p) => p.tracking === 'on').map((p) => [p.id, p]));
  let added = 0;
  const byPerson = new Map<string, ScoredLine[]>();
  for (const line of scored) {
    const personId = personOf.get(line.participantId);
    if (!personId || !tracked.has(personId)) continue;
    byPerson.set(personId, [...(byPerson.get(personId) ?? []), line]);
  }
  for (const [personId, lines] of byPerson) {
    const owner = tracked.get(personId);
    if (!owner) continue;
    const mine = samples.filter((s) => s.personId === personId);
    const taken = new Set(mine.flatMap((s) => (s.segmentId ? [s.segmentId] : [])));
    const verifiedMs = new Map<string, number>();
    const autoMs = new Map<string, number>();
    for (const s of mine) {
      if (s.rejected || !s.embedding) continue;
      const bucket = s.source === 'auto' ? autoMs : verifiedMs;
      bucket.set(s.language, (bucket.get(s.language) ?? 0) + s.durationMs);
    }
    let thisMeetingMs = mine
      .filter((s) => s.source === 'auto' && s.meetingId === meetingId && !s.rejected)
      .reduce((sum, s) => sum + s.durationMs, 0);
    const additions = [];
    const candidates: {
      line: ScoredLine;
      segment: (typeof segments)[number];
      language: string;
      durationMs: number;
    }[] = [];
    for (const line of lines.toSorted((a, b) => a.startMs - b.startMs)) {
      const segment = segments.find(
        (s) =>
          s.startMs === line.startMs &&
          s.endMs === line.endMs &&
          s.participantId === line.participantId,
      );
      if (!segment || segment.mixed || taken.has(segment.id)) continue;
      const language = normalizeLanguage(segment.language ?? meeting?.language);
      const durationMs = line.endMs - line.startMs;
      const seed = verifiedMs.get(language) ?? 0;
      if (!isKnownLanguage(language) || seed < AUTO_SEED_MS) continue;
      if ((autoMs.get(language) ?? 0) + durationMs > AUTO_RATIO * seed) continue;
      if (thisMeetingMs + durationMs > AUTO_PER_MEETING_MS) continue;
      const near = isNearCertain({
        line,
        durationMs,
        source: segment.speakerSource,
        overlapped: segments.some(
          (o) =>
            o.id !== segment.id &&
            o.participantId !== segment.participantId &&
            o.startMs < segment.endMs - 300 &&
            o.endMs > segment.startMs + 300,
        ),
        disputed:
          segment.voiceDoubt || segment.byElimination || segment.suggestedParticipantId !== null,
        extraMargin: owner.autoMargin,
      });
      if (!near) continue;
      candidates.push({ line, segment, language, durationMs });
    }
    // Only the near-certain candidates are checked for two voices, to keep the guard cheap.
    const mixed = guard
      ? await findProbablyMixed(
          guard.diarizer,
          guard.audioPath,
          candidates.map((c) => c.line),
        )
      : new Set<number>();
    await markProbablyMixed(
      db,
      [...mixed].flatMap((i) => (candidates[i] ? [candidates[i].segment.id] : [])),
    );
    for (const [i, { line, segment, language, durationMs }] of candidates.entries()) {
      if (mixed.has(i)) continue;
      // The caps are kept per line in order, a dropped mixed line frees its share again.
      if ((autoMs.get(language) ?? 0) + durationMs > AUTO_RATIO * (verifiedMs.get(language) ?? 0))
        continue;
      if (thisMeetingMs + durationMs > AUTO_PER_MEETING_MS) continue;
      autoMs.set(language, (autoMs.get(language) ?? 0) + durationMs);
      thisMeetingMs += durationMs;
      additions.push({
        kind: 'line' as const,
        embedding: line.embedding,
        embedder: line.embedder,
        meetingId,
        segmentId: segment.id,
        durationMs,
        language,
        source: 'auto' as const,
      });
    }
    if (additions.length > 0) {
      await addVoiceSamples(db, personId, additions);
      added += additions.length;
    }
  }
  return added;
}
