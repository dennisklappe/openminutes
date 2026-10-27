export interface SplitPart {
  text: string;
  startMs: number;
  endMs: number;
}

export const wordsOf = (text: string): string[] => text.split(/\s+/).filter((word) => word !== '');

/** Whether the cuts are word indexes in order, each leaving a word on both sides. */
export function validCuts(wordCount: number, cuts: readonly number[]): boolean {
  return (
    cuts.length > 0 &&
    cuts.every(
      (cut, i) =>
        Number.isInteger(cut) &&
        cut >= 1 &&
        cut < wordCount &&
        (i === 0 || cut > (cuts[i - 1] ?? 0)),
    )
  );
}

/**
 * Cuts a line into parts before the words at the given indexes. Segments store no word times, so
 * the time of a cut is estimated from the characters before it, spread over the line's duration.
 */
export function splitTimes(
  line: { text: string; startMs: number; endMs: number },
  cuts: readonly number[],
): SplitPart[] {
  const words = wordsOf(line.text);
  if (!validCuts(words.length, cuts)) throw new RangeError('Invalid split points');
  const edges = [0, ...cuts, words.length];
  const total = words.join(' ').length;
  const duration = line.endMs - line.startMs;
  const timeAt = (index: number) =>
    index === 0
      ? line.startMs
      : index === words.length
        ? line.endMs
        : line.startMs +
          Math.round((duration * words.slice(0, index).join(' ').length) / Math.max(1, total));
  return edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1] ?? words.length;
    return { text: words.slice(from, to).join(' '), startMs: timeAt(from), endMs: timeAt(to) };
  });
}
