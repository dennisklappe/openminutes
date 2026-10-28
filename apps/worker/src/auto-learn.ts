import {
  addVoiceSamples,
  agreeThreshold,
  AUTO_MARGIN,
  AUTO_MAX_RIVAL_TIMING,
  AUTO_MIN_LINE_MS,
  AUTO_MIN_TIMING_CONFIDENCE,
  AUTO_SEED_MS,
  ELIMINATION_GAP,
  findRoomVoices,
  isKnownLanguage,
  loadProfileFacts,
  loadVoiceTuning,
  normalizeLanguage,
  readiness,
  readinessKey,
  recordPrototypeHits,
  type PrototypeHit,
} from '@openminutes/core';
import {
  eq,
  inArray,
  meetings,
  participants,
  people,
  roomVoices,
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

/** What both proofs ask of a line before its voice is looked at. */
interface LineFacts {
  line: Pick<ScoredLine, 'participantId' | 'timing' | 'scores'>;
  durationMs: number;
  /** speaker_source of the saved line. */
  source: string | null;
  /** Another speaker talks over the line. */
  overlapped: boolean;
  /** The voice check doubts the line or an AI review changed or suggested it. */
  disputed: boolean;
  /** The best score the label source gave anyone else on the line, 0 for nobody. */
  rivalTiming: number;
}

/** A clean line, labelled by a source that is sure and names one person: the first proof of both rules. */
function isCleanLabel(facts: LineFacts, source: 'indicator' | 'diarization'): boolean {
  if (facts.source !== source) return false;
  if ((facts.line.timing ?? 0) < AUTO_MIN_TIMING_CONFIDENCE) return false;
  if (facts.durationMs < AUTO_MIN_LINE_MS || facts.overlapped || facts.disputed) return false;
  return facts.rivalTiming <= AUTO_MAX_RIVAL_TIMING;
}

export interface CallLabelInput extends LineFacts {
  /** The agree threshold of the labelled person, with the margin they earned from rejections. */
  threshold: number;
}

/**
 * Call-label seeding. Two independent proofs must agree: the call's speaking indicator names
 * exactly one person for a clean line of 4 s or more, and the voice matches that person's
 * profile (score at least their agree threshold and ahead of every other voice in the meeting).
 * One proof alone is not learned, the line is asked about in the review instead.
 */
export function isCallLabelProof(input: CallLabelInput): boolean {
  if (!isCleanLabel(input, 'indicator')) return false;
  const own = input.line.scores.get(input.line.participantId);
  if (own === undefined || own < input.threshold) return false;
  const others = [...input.line.scores]
    .filter(([id]) => id !== input.line.participantId)
    .map(([, score]) => score);
  return own - Math.max(0, ...others) >= AUTO_MARGIN;
}

export interface EliminationInput extends LineFacts {
  /** How well the voice fits the profile of the other, ready person. Undefined: not scored. */
  otherScore: number | undefined;
  /** The agree threshold of that other person. */
  otherThreshold: number;
  /** The meeting is an import whose speaker count is two, so diarization labels can be trusted. */
  twoSpeakers: boolean;
}

/**
 * 1:1 elimination, for a meeting of exactly two people where the other person's profile is
 * ready. A clean line of 4 s or more that clearly is not them (their score under their threshold
 * by ELIMINATION_GAP) and whose label, from the indicator or for an import with two speakers
 * from diarization, names the second person, is theirs.
 */
export function isEliminationProof(input: EliminationInput): boolean {
  const labelled =
    isCleanLabel(input, 'indicator') || (input.twoSpeakers && isCleanLabel(input, 'diarization'));
  if (!labelled || input.otherScore === undefined) return false;
  return input.otherScore < input.otherThreshold - ELIMINATION_GAP;
}

type Segment = typeof transcriptSegments.$inferSelect;
type Seat = typeof participants.$inferSelect;

interface Candidate {
  line: ScoredLine;
  segment: Segment;
  language: string;
  durationMs: number;
  personId: string;
}

const overlapsOthers = (segment: Segment, segments: readonly Segment[]) =>
  segments.some(
    (o) =>
      o.id !== segment.id &&
      o.participantId !== segment.participantId &&
      o.startMs < segment.endMs - 300 &&
      o.endMs > segment.startMs + 300,
  );

const rivalOf = (segment: Segment): number =>
  Math.max(
    0,
    ...(segment.speakerCandidates ?? [])
      .filter((c) => c.participantId !== segment.participantId)
      .map((c) => c.score),
  );

/**
 * After a meeting is transcribed and its participants are linked to people: adds the lines that
 * two independent proofs agree on to the voice profile of their speaker as auto samples (see
 * `isCallLabelProof` and `isEliminationProof`). Only for tracked people, never from a shared
 * tile, a mixed line or a line a person or an AI touched. Best effort.
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
    return await learnProven(db, meetingId, scored, guard);
  } catch (error) {
    console.error(`automatic voice learning of meeting ${meetingId} failed`, error);
    return 0;
  }
}

async function learnProven(
  db: Database,
  meetingId: string,
  scored: readonly ScoredLine[],
  guard: AutoLearnGuard | undefined,
): Promise<number> {
  const [[meeting], segments, seats, tiles, tuning] = await Promise.all([
    db
      .select({ language: meetings.language, speakerCount: meetings.speakerCount })
      .from(meetings)
      .where(eq(meetings.id, meetingId)),
    db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, meetingId)),
    db.select().from(participants).where(eq(participants.meetingId, meetingId)),
    db
      .select({ participantId: roomVoices.participantId })
      .from(roomVoices)
      .where(eq(roomVoices.meetingId, meetingId)),
    loadVoiceTuning(db),
  ]);
  const personOf = new Map(seats.flatMap((p) => (p.personId ? [[p.id, p.personId] as const] : [])));
  const ids = [...new Set(personOf.values())];
  if (ids.length === 0) return 0;
  const [owners, samples, facts] = await Promise.all([
    db.select().from(people).where(inArray(people.id, ids)),
    db.select().from(voiceSamples).where(inArray(voiceSamples.personId, ids)),
    loadProfileFacts(db, ids),
  ]);
  const tracked = new Map(owners.filter((p) => p.tracking === 'on').map((p) => [p.id, p]));
  const shared = new Set([
    ...tiles.map((t) => t.participantId),
    ...seats.filter((p) => (p.roomCount ?? 1) > 1).map((p) => p.id),
  ]);
  const thresholdOf = (personId: string) =>
    agreeThreshold(tuning, tracked.get(personId)?.autoMargin ?? 0);
  const languageOf = (segment: Segment) => normalizeLanguage(segment.language ?? meeting?.language);
  const isReady = (personId: string, language: string) => {
    const own = facts.get(readinessKey(personId, language));
    return own !== undefined && readiness(own, tuning).ready;
  };
  const segmentOf = (line: ScoredLine) =>
    segments.find(
      (s) =>
        s.startMs === line.startMs &&
        s.endMs === line.endMs &&
        s.participantId === line.participantId,
    );
  const lineFacts = (line: ScoredLine, segment: Segment): LineFacts => ({
    line,
    durationMs: line.endMs - line.startMs,
    source: segment.speakerSource,
    overlapped: overlapsOthers(segment, segments),
    disputed:
      segment.voiceDoubt || segment.byElimination || segment.suggestedParticipantId !== null,
    rivalTiming: rivalOf(segment),
  });
  // A line that already has a sample of its speaker, or was turned down for them, is left alone.
  const taken = new Set(
    samples.flatMap((s) => (s.segmentId ? [`${s.personId}|${s.segmentId}`] : [])),
  );
  const verifiedMs = (personId: string, language: string) =>
    samples
      .filter((s) => s.personId === personId && s.language === language)
      .filter((s) => s.source !== 'auto' && !s.rejected && s.embedding && !s.prunedAt)
      .reduce((sum, s) => sum + s.durationMs, 0);
  const eligible = (line: ScoredLine) => {
    const segment = segmentOf(line);
    const personId = personOf.get(line.participantId);
    if (!segment || !personId || !tracked.has(personId)) return undefined;
    if (segment.mixed || segment.roomVoiceId || shared.has(line.participantId)) return undefined;
    return { segment, personId };
  };

  await noteMatches(db, scored, personOf, tracked, segmentOf, languageOf, thresholdOf);

  const found = new Map<string, Candidate>();
  const consider = (line: ScoredLine, segment: Segment, personId: string) => {
    const key = `${personId}|${segment.id}`;
    const language = languageOf(segment);
    if (taken.has(key) || found.has(key) || !isKnownLanguage(language)) return;
    found.set(key, { line, segment, language, durationMs: line.endMs - line.startMs, personId });
  };

  // Rule 1: the call's label and the voice agree.
  for (const line of scored) {
    const hit = eligible(line);
    if (!hit || verifiedMs(hit.personId, languageOf(hit.segment)) < AUTO_SEED_MS) continue;
    const proof = isCallLabelProof({
      ...lineFacts(line, hit.segment),
      threshold: thresholdOf(hit.personId),
    });
    if (proof) consider(line, hit.segment, hit.personId);
  }

  // Rule 2: a meeting of two, one of them ready, so a line that is clearly not them is the other.
  const eliminateFor = (ready: Seat, other: Seat) => {
    const readyId = personOf.get(ready.id);
    const otherId = personOf.get(other.id);
    if (!readyId || !otherId || readyId === otherId) return;
    if (!tracked.has(readyId) || !tracked.has(otherId)) return;
    const notThem = scored.filter((line) => {
      const score = line.scores.get(ready.id);
      const segment = segmentOf(line);
      return (
        score !== undefined &&
        segment !== undefined &&
        isReady(readyId, languageOf(segment)) &&
        score < thresholdOf(readyId) - ELIMINATION_GAP &&
        line.endMs - line.startMs >= AUTO_MIN_LINE_MS
      );
    });
    // A third voice among the lines that are not the ready person: this is not a pair.
    const voices = findRoomVoices(
      notThem.map((line, key) => ({
        key,
        embedding: line.embedding,
        durationMs: line.endMs - line.startMs,
      })),
    );
    if (voices.length >= 2) return;
    for (const line of notThem) {
      const hit = line.participantId === other.id ? eligible(line) : undefined;
      if (!hit) continue;
      const proof = isEliminationProof({
        ...lineFacts(line, hit.segment),
        otherScore: line.scores.get(ready.id),
        otherThreshold: thresholdOf(readyId),
        twoSpeakers: meeting?.speakerCount === 2,
      });
      if (proof) consider(line, hit.segment, hit.personId);
    }
  };
  const humans = seats.filter((p) => !p.isBot);
  const [one, two] = humans;
  if (humans.length === 2 && one && two && !shared.has(one.id) && !shared.has(two.id)) {
    eliminateFor(one, two);
    eliminateFor(two, one);
  }

  const candidates = [...found.values()];
  // Only the proven candidates are checked for two voices, to keep the guard cheap.
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
  const byPerson = new Map<string, Candidate[]>();
  for (const [i, candidate] of candidates.entries()) {
    if (mixed.has(i)) continue;
    byPerson.set(candidate.personId, [...(byPerson.get(candidate.personId) ?? []), candidate]);
  }
  let added = 0;
  for (const [personId, list] of byPerson) {
    await addVoiceSamples(
      db,
      personId,
      list
        .toSorted((a, b) => a.line.startMs - b.line.startMs)
        .map(({ line, segment, language, durationMs }) => ({
          kind: 'line' as const,
          embedding: line.embedding,
          embedder: line.embedder,
          meetingId,
          segmentId: segment.id,
          durationMs,
          language,
          source: 'auto' as const,
        })),
    );
    added += list.length;
  }
  return added;
}

/** Tells each profile which of its ways of sounding the lines of its person matched. */
async function noteMatches(
  db: Database,
  scored: readonly ScoredLine[],
  personOf: ReadonlyMap<string, string>,
  tracked: ReadonlyMap<string, unknown>,
  segmentOf: (line: ScoredLine) => Segment | undefined,
  languageOf: (segment: Segment) => string,
  thresholdOf: (personId: string) => number,
): Promise<void> {
  const hits = new Map<string, PrototypeHit[]>();
  for (const line of scored) {
    const personId = personOf.get(line.participantId);
    const segment = segmentOf(line);
    const score = line.scores.get(line.participantId);
    if (!personId || !tracked.has(personId) || !segment || segment.mixed) continue;
    if (score === undefined || score < thresholdOf(personId)) continue;
    hits.set(personId, [
      ...(hits.get(personId) ?? []),
      { embedding: line.embedding, language: languageOf(segment), outcome: 'matched' },
    ]);
  }
  for (const [personId, list] of hits) await recordPrototypeHits(db, personId, list);
}
