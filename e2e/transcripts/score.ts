export interface RefWord {
  word: string;
  speaker: string;
  interjection: boolean;
  utterance: number;
}

export interface HypWord {
  word: string;
  speaker: string | null;
}

export interface Score {
  words: number;
  wer: number;
  attribution: number;
  sentences: number;
  interjections: number | undefined;
}

export const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

type Step = 'match' | 'sub' | 'del' | 'ins';

function align(ref: readonly string[], hyp: readonly string[]): [number | null, number | null][] {
  const cost = Array.from({ length: ref.length + 1 }, (_, i) =>
    Array.from({ length: hyp.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => cost[i]?.[j] ?? 0;
  for (let i = 1; i <= ref.length; i++) {
    for (let j = 1; j <= hyp.length; j++) {
      const row = cost[i];
      if (row) {
        row[j] = Math.min(
          at(i - 1, j - 1) + (ref[i - 1] === hyp[j - 1] ? 0 : 1),
          at(i - 1, j) + 1,
          at(i, j - 1) + 1,
        );
      }
    }
  }
  const pairs: [number | null, number | null][] = [];
  let i = ref.length;
  let j = hyp.length;
  while (i > 0 || j > 0) {
    const step: Step =
      i > 0 && j > 0 && at(i, j) === at(i - 1, j - 1) + (ref[i - 1] === hyp[j - 1] ? 0 : 1)
        ? 'match'
        : i > 0 && at(i, j) === at(i - 1, j) + 1
          ? 'del'
          : 'ins';
    if (step === 'match') pairs.push([--i, --j]);
    else if (step === 'del') pairs.push([--i, null]);
    else pairs.push([null, --j]);
  }
  return pairs.reverse();
}

/**
 * Word error rate, the share of aligned words that carry the right speaker and the share of
 * spoken sentences whose aligned words all carry the right speaker.
 */
export function score(ref: readonly RefWord[], hyp: readonly HypWord[]): Score {
  const pairs = align(
    ref.map((r) => r.word),
    hyp.map((h) => h.word),
  );
  const errors = pairs.filter(
    ([i, j]) => i === null || j === null || ref[i]?.word !== hyp[j]?.word,
  ).length;
  const aligned = pairs.flatMap(([i, j]) => {
    const r = i === null ? undefined : ref[i];
    const h = j === null ? undefined : hyp[j];
    return r && h
      ? [{ right: r.speaker === h.speaker, interjection: r.interjection, utterance: r.utterance }]
      : [];
  });
  const share = (items: typeof aligned) =>
    items.length === 0 ? undefined : items.filter((a) => a.right).length / items.length;
  const wrong = new Set(aligned.filter((a) => !a.right).map((a) => a.utterance));
  const utterances = new Set(aligned.map((a) => a.utterance));
  const whole = utterances.size - wrong.size;
  return {
    words: ref.length,
    wer: errors / ref.length,
    attribution: share(aligned) ?? 0,
    sentences: utterances.size === 0 ? 0 : whole / utterances.size,
    interjections: share(aligned.filter((a) => a.interjection)),
  };
}
