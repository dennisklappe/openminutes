import type { SpeakerCandidate, SpeakerSource } from '@openminutes/db';
import { overlap, type SpeakerSpan, type Timed } from './speaker-types.js';

/** Lines whose speaker confidence is below this are shown as uncertain. */
export const LOW_SPEAKER_CONFIDENCE = 0.7;

/** Diarized turns shorter than this have unreliable voice prints and always count as uncertain. */
export const SHORT_UTTERANCE_MS = 2500;

/** An embedding margin of this size or more is as good as it gets. */
const FULL_EMBEDDING_MARGIN = 0.3;

const MARGIN_FLOOR = 0.5;
const SHORT_BASE = 0.3;
const SHORT_SLOPE = 0.35;
const MAX_CANDIDATES = 3;

/** The review may only suggest a speaker the audio gave at least this much of the line. */
export const MIN_SUGGESTION_SCORE = 0.2;

/**
 * The speakers the review may suggest for a line: the ones the audio scored, other than the one
 * it carries and the ones a person already turned down. Nobody for a line a person set.
 */
export function suggestionChoices(line: {
  participantId: string | null;
  speakerSource: SpeakerSource | null;
  speakerCandidates: SpeakerCandidate[] | null;
  rejectedSuggestions: readonly string[];
}): string[] {
  if (line.speakerSource === 'user') return [];
  return (line.speakerCandidates ?? [])
    .filter(
      (candidate) =>
        candidate.score >= MIN_SUGGESTION_SCORE &&
        candidate.participantId !== line.participantId &&
        !line.rejectedSuggestions.includes(candidate.participantId),
    )
    .map((candidate) => candidate.participantId);
}

/** A line is uncertain when it has a low confidence and nobody has confirmed its speaker. */
export const isUncertain = (line: {
  speakerConfidence: number | null;
  speakerSource: SpeakerSource | null;
}): boolean =>
  line.speakerSource !== 'user' &&
  line.speakerConfidence !== null &&
  line.speakerConfidence < LOW_SPEAKER_CONFIDENCE;

export interface SpeakerScore {
  confidence: number | null;
  candidates: SpeakerCandidate[] | null;
}

interface Evidence {
  totals: Map<string, number>;
  winnerMargin: { weighted: number; weight: number };
}

const round = (value: number) => Math.round(value * 100) / 100;

function gather(segment: Timed, winner: string, spans: readonly SpeakerSpan[]): Evidence {
  const totals = new Map<string, number>();
  const winnerMargin = { weighted: 0, weight: 0 };
  for (const span of spans) {
    if (span.startMs >= segment.endMs) break;
    const shared = overlap(segment, span);
    if (shared <= 0) continue;
    totals.set(span.participantId, (totals.get(span.participantId) ?? 0) + shared);
    if (span.participantId === winner && span.margin !== undefined) {
      winnerMargin.weighted += span.margin * shared;
      winnerMargin.weight += shared;
    }
  }
  return { totals, winnerMargin };
}

function candidatesOf(totals: ReadonlyMap<string, number>): SpeakerCandidate[] {
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, MAX_CANDIDATES)
    .map(([participantId, shared]) => ({ participantId, score: round(shared / sum) }));
}

/**
 * A heuristic score from 0 to 1, not a calibrated probability: 80% does not mean four out of
 * five such lines are right, only that it is a safer bet than 50%. It is
 * `dominance * (0.5 + 0.5 * coverage)`, where coverage is the share of the segment the winner's
 * spans cover and dominance is the winner's overlap over winner plus second best (0.5 when no
 * span touches the segment). For diarized audio it is scaled by `0.5 + 0.5 * margin / 0.3`
 * (the voice similarity to the own speaker minus that to the runner up, clamped), and a turn
 * under 2.5 s is capped at `0.3 + 0.35 * duration / 2.5 s`, always below the uncertain line,
 * because a voice print of a few words cannot tell speakers apart.
 */
export function scoreSpeaker(
  segment: Timed & { participantId: string | null },
  spans: readonly SpeakerSpan[],
  source: 'indicator' | 'diarization',
): SpeakerScore {
  const winner = segment.participantId;
  if (winner === null) return { confidence: null, candidates: null };
  const { totals, winnerMargin } = gather(segment, winner, spans);
  const duration = Math.max(1, segment.endMs - segment.startMs);
  const won = totals.get(winner) ?? 0;
  const second = Math.max(0, ...[...totals].filter(([id]) => id !== winner).map(([, v]) => v));
  const coverage = Math.min(1, won / duration);
  const dominance = won + second === 0 ? 0.5 : won / (won + second);
  let confidence = dominance * (0.5 + 0.5 * coverage);
  if (winnerMargin.weight > 0) {
    const margin = Math.min(
      1,
      Math.max(0, winnerMargin.weighted / winnerMargin.weight / FULL_EMBEDDING_MARGIN),
    );
    confidence *= MARGIN_FLOOR + (1 - MARGIN_FLOOR) * margin;
  }
  if (source === 'diarization' && duration < SHORT_UTTERANCE_MS) {
    confidence = Math.min(confidence, SHORT_BASE + (SHORT_SLOPE * duration) / SHORT_UTTERANCE_MS);
  }
  return { confidence: round(confidence), candidates: candidatesOf(totals) };
}
