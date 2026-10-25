import type { SpeakerSpan, TimedWord } from './speaker-types.js';

const ONSET_GAP_MS = 300;
const MIN_SAMPLES = 3;
const MAX_START_LAG_MS = 2000;
const MAX_END_LAG_MS = 3000;
const LAG_STEP_MS = 50;
const WINDOW_MS = 500;
const MIN_ADJUSTED_SPAN_MS = 500;

export interface SpeakerLag {
  startMs: number;
  endMs: number;
}

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

function turnEdges(words: readonly TimedWord[]): { onsets: number[]; offsets: number[] } {
  const onsets: number[] = [];
  const offsets: number[] = [];
  words.forEach((word, i) => {
    const before = words[i - 1];
    const after = words[i + 1];
    if (!before || word.startMs - before.endMs >= ONSET_GAP_MS) onsets.push(word.startMs);
    if (!after || after.startMs - word.endMs >= ONSET_GAP_MS) offsets.push(word.endMs);
  });
  return { onsets, offsets };
}

/**
 * Every span has one true lag, so the right lag is the one that most spans can explain, while
 * the pauses inside a turn that also fall in the window scatter over all lags. Each span splits
 * one vote over its candidate edges (a span with many pauses nearby is less sure), the lag with
 * the most votes in a window wins and the median of the candidates in that window refines it.
 */
function lagOf(
  spans: readonly SpeakerSpan[],
  edges: readonly number[],
  pick: (span: SpeakerSpan) => number,
  maxLagMs: number,
): number {
  const perSpan = spans.map((span) => {
    const at = pick(span);
    return edges.map((edge) => at - edge).filter((lag) => lag >= -ONSET_GAP_MS && lag <= maxLagMs);
  });
  if (perSpan.filter((lags) => lags.length > 0).length < MIN_SAMPLES) return 0;
  let best = { lag: 0, votes: 0 };
  for (let lag = 0; lag <= maxLagMs; lag += LAG_STEP_MS) {
    const votes = perSpan.reduce(
      (sum, lags) =>
        sum + lags.filter((l) => Math.abs(l - lag) <= WINDOW_MS).length / (lags.length || 1),
      0,
    );
    if (votes > best.votes + 1e-9) best = { lag, votes };
  }
  const close = perSpan.flatMap((lags) => {
    const inside = lags.filter((l) => Math.abs(l - best.lag) <= WINDOW_MS);
    return inside.length
      ? [inside.reduce((a, b) => (Math.abs(b - best.lag) < Math.abs(a - best.lag) ? b : a))]
      : [];
  });
  return close.length < MIN_SAMPLES ? 0 : Math.min(maxLagMs, Math.max(0, median(close)));
}

/**
 * Measures how far the platform's speaking indicator trails the audio: it lights up after the
 * speaker starts and stays lit after they stop. Compares each span edge with the nearest word
 * that starts or ends a stretch of speech, and takes the median. Returns zero for an edge when
 * there are too few matches to say.
 */
export function estimateLag(
  spans: readonly SpeakerSpan[],
  words: readonly TimedWord[],
): SpeakerLag {
  const { onsets, offsets } = turnEdges(words);
  return {
    startMs: lagOf(spans, onsets, (span) => span.startMs, MAX_START_LAG_MS),
    endMs: lagOf(spans, offsets, (span) => span.endMs, MAX_END_LAG_MS),
  };
}

export function removeLag(spans: readonly SpeakerSpan[], lag: SpeakerLag): SpeakerSpan[] {
  return spans.map((span) => {
    const startMs = span.startMs - lag.startMs;
    return {
      participantId: span.participantId,
      startMs,
      endMs: Math.max(span.endMs - lag.endMs, startMs + MIN_ADJUSTED_SPAN_MS),
    };
  });
}
