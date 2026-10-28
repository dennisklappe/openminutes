import { overlap, type SpeakerSpan, type Timed, type TimedWord } from './speaker-types.js';

/** A part of a split line is at least this long, or it is flicker and not a turn. */
export const SPLIT_MIN_PART_MS = 600;
/** A part of a split line holds at least this many words. */
export const SPLIT_MIN_PART_WORDS = 2;
/**
 * The platform shows a new speaker some time after they started, so the cut between two speakers
 * is placed this far before the point where the second indicator lights up, but never earlier
 * than the end of the first speaker's own interval.
 */
export const SPLIT_LAG_TOLERANCE_MS = 400;

export interface SplitPart extends Timed {
  participantId: string;
  text: string;
}

/**
 * Word times for a line that has none, spread over the line by characters: a longer word takes
 * more time. Good enough to find where in the text a known moment falls, not to play it.
 */
export function estimateWords(text: string, startMs: number, endMs: number): TimedWord[] {
  const words = text.split(/\s+/).filter((word) => word !== '');
  const total = words.reduce((sum, word) => sum + word.length + 1, 0);
  let at = startMs;
  return words.map((word) => {
    const length = ((word.length + 1) / total) * (endMs - startMs);
    const found = { text: word, startMs: Math.round(at), endMs: Math.round(at + length) };
    at += length;
    return found;
  });
}

interface Run extends Timed {
  participantId: string;
}

/** Stretches of the line in which exactly one speaker's interval is lit, merged per speaker. */
function soloRuns(line: Timed, spans: readonly SpeakerSpan[]): Run[] {
  const inside = spans.filter((span) => overlap(line, span) > 0);
  const edges = [
    ...new Set(
      inside.flatMap((span) => [
        Math.max(line.startMs, span.startMs),
        Math.min(line.endMs, span.endMs),
      ]),
    ),
  ].toSorted((a, b) => a - b);
  const runs: Run[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const from = edges[i] ?? 0;
    const to = edges[i + 1] ?? 0;
    const lit = new Set(
      inside
        .filter((span) => span.startMs < to && span.endMs > from)
        .map((span) => span.participantId),
    );
    const [only] = lit;
    if (lit.size !== 1 || only === undefined) continue;
    const last = runs.at(-1);
    if (last?.participantId === only) last.endMs = to;
    else runs.push({ participantId: only, startMs: from, endMs: to });
  }
  return runs;
}

/**
 * Cuts a line that has no word times where the speaker changes inside it, from the speaking
 * intervals alone. Returns undefined when the line is one speaker's. A part must last
 * SPLIT_MIN_PART_MS and hold SPLIT_MIN_PART_WORDS words, and only stretches where one speaker alone
 * is lit count, so overlap and flicker never split a line. The words are placed by characters, so
 * the cut is as good as that estimate; lines with word times go through `assignSpeakers` words.
 */
export function splitAtChanges(
  line: Timed & { text: string },
  spans: readonly SpeakerSpan[],
): SplitPart[] | undefined {
  const words = estimateWords(line.text, line.startMs, line.endMs);
  if (words.length < 2 * SPLIT_MIN_PART_WORDS) return undefined;
  const runs = soloRuns(line, spans).filter((run) => run.endMs - run.startMs >= SPLIT_MIN_PART_MS);
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last?.participantId === run.participantId) last.endMs = run.endMs;
    else merged.push({ ...run });
  }
  if (merged.length < 2) return undefined;
  // The cut after each part: before the next speaker lit up, never inside the part's own run.
  const cuts = merged.map((run, i) => {
    const next = merged[i + 1];
    return next ? Math.max(run.endMs, next.startMs - SPLIT_LAG_TOLERANCE_MS) : line.endMs;
  });
  const parts = merged.map((run, i) => {
    const begin = i === 0 ? line.startMs : (cuts[i - 1] ?? line.startMs);
    const end = cuts[i] ?? line.endMs;
    return {
      participantId: run.participantId,
      words: words.filter((word) => {
        const middle = (word.startMs + word.endMs) / 2;
        return middle >= begin && middle < end;
      }),
    };
  });
  // A part with too few words joins the part next to it instead of losing its words.
  const good: typeof parts = [];
  let carried: TimedWord[] = [];
  for (const part of parts) {
    const all = [...carried, ...part.words];
    if (part.words.length >= SPLIT_MIN_PART_WORDS) {
      good.push({ participantId: part.participantId, words: all });
      carried = [];
    } else if (good.length > 0) {
      good[good.length - 1]?.words.push(...part.words);
    } else {
      carried = all;
    }
  }
  if (good.length < 2) return undefined;
  return good.map((part) => ({
    participantId: part.participantId,
    text: part.words.map((word) => word.text).join(' '),
    startMs: part.words[0]?.startMs ?? line.startMs,
    endMs: part.words.at(-1)?.endMs ?? line.endMs,
  }));
}
