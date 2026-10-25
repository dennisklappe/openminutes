import {
  DIARIZATION_WEIGHT,
  endsSentence,
  overlap,
  type SpeakerSpan,
  type Timed,
  type TimedWord,
} from './speaker-types.js';

const WORD_TOLERANCE_MS = 100;
const SWITCH_COST = 1;
const GAP_RELIEF_MS = 400;
const MIN_GAP_FACTOR = 0.2;
const SENTENCE_FACTOR = 0.5;
const SHORT_SPAN_BONUS = 0.8;
const CROWDED_COVERAGE = 0.5;

/**
 * How well each speaker's intervals explain a word, from 0 to 1. When several speakers cover the
 * word, the one with the shortest interval gets a bonus: a short interval inside a long one is
 * an interjection, while the long one is just the speaker who carries on.
 */
export function coverage(
  word: TimedWord,
  spans: readonly SpeakerSpan[],
  shared: (word: Timed, span: SpeakerSpan) => number = overlap,
): Map<string, number> {
  const padded = {
    startMs: word.startMs - WORD_TOLERANCE_MS,
    endMs: word.endMs + WORD_TOLERANCE_MS,
  };
  const length = padded.endMs - padded.startMs;
  const sums = new Map<string, number>();
  const shortest = new Map<string, number>();
  for (const span of spans) {
    if (span.startMs >= padded.endMs) break;
    const common = shared(padded, span);
    if (common <= 0) continue;
    sums.set(span.participantId, (sums.get(span.participantId) ?? 0) + common);
    shortest.set(
      span.participantId,
      Math.min(shortest.get(span.participantId) ?? Infinity, span.endMs - span.startMs),
    );
  }
  const covered = new Map(
    [...sums].map(([participantId, common]) => [participantId, Math.min(1, common / length)]),
  );
  const crowd = [...covered].filter(([, share]) => share >= CROWDED_COVERAGE).map(([id]) => id);
  const longest = Math.max(...crowd.map((id) => shortest.get(id) ?? 0));
  if (crowd.length > 1) {
    for (const id of crowd) {
      const bonus = SHORT_SPAN_BONUS * (1 - (shortest.get(id) ?? longest) / longest);
      covered.set(id, (covered.get(id) ?? 0) + bonus);
    }
  }
  return covered;
}

function switchCost(before: TimedWord, word: TimedWord): number {
  const gap = Math.min(GAP_RELIEF_MS, Math.max(0, word.startMs - before.endMs));
  const gapFactor = 1 - (1 - MIN_GAP_FACTOR) * (gap / GAP_RELIEF_MS);
  return SWITCH_COST * gapFactor * (endsSentence(before) ? SENTENCE_FACTOR : 1);
}

/**
 * Picks one speaker per word. A word costs 1 minus the share of it that the speaker's
 * (lag corrected) intervals cover, and changing speaker costs more in the middle of a phrase
 * than across a pause or a sentence end. The cheapest path through the words (Viterbi) drops
 * indicator flicker, keeps one-word glitches out of long turns and puts each change of speaker
 * in the nearest silence. Words nobody covers stay with the current speaker. A hint per word,
 * the participant a diarizing provider put the word with, adds to that participant's coverage.
 */
export function assignWords(
  words: readonly TimedWord[],
  spans: readonly SpeakerSpan[],
  hints: readonly (string | null)[] = [],
): (string | null)[] {
  const sorted = spans.toSorted((a, b) => a.startMs - b.startMs);
  const speakers = [...new Set(sorted.map((span) => span.participantId))];
  if (speakers.length === 0) return words.map(() => null);

  let costs = speakers.map(() => 0);
  const came: number[][] = [];
  words.forEach((word, i) => {
    const before = words[i - 1];
    const covered = coverage(word, sorted);
    const hint = hints[i];
    if (hint) covered.set(hint, (covered.get(hint) ?? 0) + DIARIZATION_WEIGHT);
    const change = before ? switchCost(before, word) : 0;
    const from: number[] = [];
    costs = speakers.map((speaker, to) => {
      let best = to;
      let bestCost = costs[to] ?? 0;
      costs.forEach((cost, other) => {
        if (cost + change < bestCost) [best, bestCost] = [other, cost + change];
      });
      from.push(best);
      return bestCost + 1 - (covered.get(speaker) ?? 0);
    });
    came.push(from);
  });

  let at = costs.indexOf(Math.min(...costs));
  const owners: number[] = [];
  for (let i = words.length - 1; i >= 0; i--) {
    owners[i] = at;
    at = came[i]?.[at] ?? at;
  }
  return owners.map((index) => speakers[index] ?? null);
}
