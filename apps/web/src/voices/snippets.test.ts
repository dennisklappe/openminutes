import { describe, expect, it } from 'vitest';
import { pickSnippets } from './snippets.js';

const seg = (startS: number, lengthS: number, text = 'This is a clean sentence.') => ({
  startMs: startS * 1000,
  endMs: (startS + lengthS) * 1000,
  text,
});

describe('pickSnippets', () => {
  it('prefers the longest clean segments of 2 to 12 seconds, spread apart', () => {
    const picked = pickSnippets([
      seg(0, 1),
      seg(5, 20),
      seg(10, 9),
      seg(12, 8),
      seg(100, 6),
      seg(200, 4),
      seg(300, 3, 'Uh.'),
    ]);
    expect(picked.map((s) => s.startMs / 1000)).toEqual([10, 100, 200]);
  });

  it('fills up with close segments when there are not enough spread ones', () => {
    const picked = pickSnippets([seg(0, 5), seg(3, 6), seg(6, 4)]);
    expect(picked.map((s) => s.startMs / 1000)).toEqual([0, 3, 6]);
  });

  it('returns nothing when no segment is usable', () => {
    expect(pickSnippets([seg(0, 1), seg(5, 30), seg(40, 3, '...')])).toEqual([]);
  });
});
