import type { DiarizedTurn } from '../../packages/providers/src/diarization/types.js';
import type { TruthUtterance } from './indicator.js';

const FRAME_MS = 10;
export const SHORT_UTTERANCE_MS = 2000;

interface Mapping {
  /** Index into `clusters` for each name under the best one-to-one mapping, -1 when none is left. */
  columns: number[];
  score: number;
}

const speakerAt = (turns: DiarizedTurn[], ms: number): number | undefined =>
  turns.find((t) => t.startMs <= ms && ms < t.endMs)?.speaker;

function bestMapping(overlap: number[][], row = 0, used = new Set<number>()): Mapping {
  const counts = overlap[row];
  if (!counts) return { columns: [], score: 0 };
  const skipped = bestMapping(overlap, row + 1, used);
  let best: Mapping = { columns: [-1, ...skipped.columns], score: skipped.score };
  counts.forEach((count, cluster) => {
    if (used.has(cluster)) return;
    used.add(cluster);
    const rest = bestMapping(overlap, row + 1, used);
    used.delete(cluster);
    if (count + rest.score > best.score) {
      best = { columns: [cluster, ...rest.columns], score: count + rest.score };
    }
  });
  return best;
}

function match(turns: DiarizedTurn[], truth: TruthUtterance[]) {
  const names = [...new Set(truth.map((u) => u.speaker))];
  const clusters = [...new Set(turns.map((t) => t.speaker))];
  const overlap = names.map(() => clusters.map(() => 0));
  let speech = 0;
  for (const u of truth) {
    const row = overlap[names.indexOf(u.speaker)];
    for (let ms = u.startMs; ms < u.endMs; ms += FRAME_MS) {
      speech++;
      const speaker = speakerAt(turns, ms);
      const column = speaker === undefined ? -1 : clusters.indexOf(speaker);
      if (row && column >= 0) row[column] = (row[column] ?? 0) + 1;
    }
  }
  return { names, clusters, speech, mapping: bestMapping(overlap) };
}

/** Share of true speech time whose cluster matches its speaker under the best one-to-one mapping. */
export function attributedShare(turns: DiarizedTurn[], truth: TruthUtterance[]): number {
  const { speech, mapping } = match(turns, truth);
  return speech === 0 ? 0 : mapping.score / speech;
}

/**
 * Fraction of utterances shorter than SHORT_UTTERANCE_MS that are mostly attributed to the cluster
 * their speaker maps to over the whole conversation. Undefined when there are no short ones.
 */
export function shortTurnAccuracy(
  turns: DiarizedTurn[],
  truth: TruthUtterance[],
): number | undefined {
  const short = truth.filter((u) => u.endMs - u.startMs < SHORT_UTTERANCE_MS);
  if (short.length === 0) return undefined;
  const { names, clusters, mapping } = match(turns, truth);
  const right = short.filter((u) => {
    const cluster = clusters[mapping.columns[names.indexOf(u.speaker)] ?? -1];
    let hits = 0;
    let frames = 0;
    for (let ms = u.startMs; ms < u.endMs; ms += FRAME_MS) {
      frames++;
      if (cluster !== undefined && speakerAt(turns, ms) === cluster) hits++;
    }
    return hits * 2 > frames;
  });
  return right.length / short.length;
}
