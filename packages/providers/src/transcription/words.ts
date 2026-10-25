import type { SegmentWord } from '../types.js';

const LOOKAHEAD = 2;
const GAP_TOLERANCE_MS = 250;

const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function merged(
  words: readonly SegmentWord[],
  from: number,
  token: string,
): { count: number; word: SegmentWord } | undefined {
  const target = bare(token);
  let spelled = '';
  for (let to = from; to < Math.min(words.length, from + 1 + LOOKAHEAD); to++) {
    spelled += bare(words[to]?.text ?? '');
    if (spelled === target) {
      const first = words[from];
      const last = words[to];
      if (!first || !last) return undefined;
      return {
        count: to - from + 1,
        word: { startMs: first.startMs, endMs: last.endMs, text: token },
      };
    }
    if (!target.startsWith(spelled)) return undefined;
  }
  return undefined;
}

/**
 * Word timestamps from the OpenAI API come without punctuation and with numbers cut at
 * separators, while the segment text has both right. Walks the words in step with the segment's
 * tokens and gives each word, or each run of words that spell one token, the token's text.
 */
function punctuate(words: readonly SegmentWord[], text: string): SegmentWord[] {
  const tokens = text.split(/\s+/).filter((token) => token !== '');
  const result: SegmentWord[] = [];
  let next = 0;
  for (let i = 0; i < words.length;) {
    let match: ReturnType<typeof merged>;
    let at = next;
    for (; at < Math.min(tokens.length, next + 1 + LOOKAHEAD); at++) {
      match = bare(words[i]?.text ?? '') === '' ? undefined : merged(words, i, tokens[at] ?? '');
      if (match) break;
    }
    const word = words[i];
    if (match) {
      result.push(match.word);
      i += match.count;
      next = at + 1;
    } else if (word) {
      result.push(word);
      i++;
    }
  }
  return result;
}

/**
 * Hands every word to the segment it falls in, by the middle of the word. A word the API timed
 * at zero length at the end of a segment, or just after it, stays with that segment.
 */
export function wordsBySegment(
  words: readonly SegmentWord[],
  segments: readonly { startMs: number; endMs: number; text: string }[],
): SegmentWord[][] {
  const grouped = segments.map((): SegmentWord[] => []);
  for (const word of words) {
    const middle = (word.startMs + word.endMs) / 2;
    const index = segments.findLastIndex((segment) => segment.startMs <= middle);
    const segment = segments[index];
    if (segment && middle <= segment.endMs + GAP_TOLERANCE_MS) grouped[index]?.push(word);
  }
  return grouped.map((group, i) => punctuate(group, segments[i]?.text ?? ''));
}
