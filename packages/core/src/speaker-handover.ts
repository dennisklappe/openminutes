import type { SpeakerLag } from './speaker-lag.js';
import { endsSentence, type SpeakerSpan, type TimedWord } from './speaker-types.js';

const MAX_HANDOVER_GAP_MS = 1500;
const MIN_HANDOVER_SPAN_MS = 1500;
const MAX_HANDOVER_OVERLAP_MS = 2500;
const MAX_LAG_MS = 3500;
const LAG_HEADROOM_MS = 2200;
const LATE_SLACK_MS = 300;
const LAG_ERROR_MS = 1500;
const MIN_PAUSE_MS = 300;
const FULL_PAUSE_MS = 1000;
const DISTANCE_PENALTY = 0.15;
const MIN_ADJUSTED_SPAN_MS = 500;

interface Pause {
  at: number;
  resumes: number;
  score: number;
}

function pauses(words: readonly TimedWord[]): Pause[] {
  return words.flatMap((word, i) => {
    const next = words[i + 1];
    if (!next) return [];
    const gap = Math.max(0, next.startMs - word.endMs);
    const sentenceEnd = endsSentence(word);
    if (!sentenceEnd && gap < MIN_PAUSE_MS) return [];
    return [
      {
        at: word.endMs,
        resumes: next.startMs,
        score: (sentenceEnd ? 1 : 0) + Math.min(gap, FULL_PAUSE_MS) / FULL_PAUSE_MS,
      },
    ];
  });
}

function boundaryFor(
  shown: number,
  lag: number,
  all: readonly Pause[],
  reach: number,
  ceiling: number,
): number | undefined {
  let best: { at: number; score: number } | undefined;
  for (const pause of all) {
    if (pause.at < shown - reach || pause.at > ceiling) continue;
    if (pause.resumes > shown + LATE_SLACK_MS) continue;
    const score = pause.score - (DISTANCE_PENALTY * Math.abs(shown - lag - pause.at)) / 1000;
    if (!best || score > best.score) best = { at: pause.at, score };
  }
  return best?.at;
}

/**
 * The platform shows a new speaker some time after they started, and that delay differs per
 * turn. When one speaker's indicator hands over to another's, the real turn change is a pause
 * or a sentence end shortly before the indicator changed, so both intervals are moved to the best
 * such pause instead of using one lag for everything. Takes the raw intervals, which say where
 * the indicator changed, and the intervals corrected by the overall lag, which are kept for
 * handovers without a pause to snap to.
 */
export function snapHandovers(
  raw: readonly SpeakerSpan[],
  corrected: readonly SpeakerSpan[],
  words: readonly TimedWord[],
  lag: SpeakerLag,
): SpeakerSpan[] {
  const reach = Math.min(MAX_LAG_MS, Math.max(lag.startMs, lag.endMs) + LAG_HEADROOM_MS);
  const adjusted = corrected.map((span) => ({ ...span }));
  const all = pauses(words);
  raw.forEach((next, i) => {
    if (next.endMs - next.startMs < MIN_HANDOVER_SPAN_MS) return;
    const previous = raw.reduce<number | undefined>((best, span, j) => {
      const eligible = span.participantId !== next.participantId && span.startMs < next.startMs;
      return eligible && (best === undefined || span.startMs > (raw[best]?.startMs ?? 0))
        ? j
        : best;
    }, undefined);
    const before = previous === undefined ? undefined : raw[previous];
    const distance = (before?.endMs ?? 0) - next.startMs;
    if (distance < -MAX_HANDOVER_GAP_MS || distance > MAX_HANDOVER_OVERLAP_MS) return;
    const after = previous === undefined ? undefined : adjusted[previous];
    const into = adjusted[i];
    if (!before || !after || !into) return;
    const ceiling = Math.min(after.endMs, into.startMs) + LAG_ERROR_MS;
    const shown = Math.min(before.endMs, next.startMs);
    const at = boundaryFor(
      shown,
      shown === next.startMs ? lag.startMs : lag.endMs,
      all,
      reach,
      ceiling,
    );
    if (at === undefined || at - after.startMs < MIN_ADJUSTED_SPAN_MS) return;
    after.endMs = at;
    into.startMs = at;
  });
  return adjusted;
}
