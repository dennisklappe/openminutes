import { describe, expect, it } from 'vitest';
import { splitTimes, validCuts, wordsOf } from './split-times.js';

const line = { text: 'one two three four five six', startMs: 1000, endMs: 7000 };

describe('splitTimes', () => {
  it('cuts in proportion to the characters before the cut', () => {
    const [first, second] = splitTimes({ text: 'aaaa bbbb', startMs: 0, endMs: 9000 }, [1]);
    expect(first).toEqual({ text: 'aaaa', startMs: 0, endMs: 4000 });
    expect(second).toEqual({ text: 'bbbb', startMs: 4000, endMs: 9000 });
  });

  it('keeps the outer times and makes the parts follow each other', () => {
    const parts = splitTimes(line, [2, 4]);
    expect(parts.map((p) => p.text)).toEqual(['one two', 'three four', 'five six']);
    expect(parts[0]?.startMs).toBe(1000);
    expect(parts.at(-1)?.endMs).toBe(7000);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i]?.startMs).toBe(parts[i - 1]?.endMs);
    }
    expect(parts.every((p) => p.endMs > p.startMs)).toBe(true);
  });

  it('collapses extra whitespace and refuses cuts outside the words', () => {
    expect(wordsOf('  a   b\nc ')).toEqual(['a', 'b', 'c']);
    expect(() => splitTimes(line, [0])).toThrow(RangeError);
    expect(() => splitTimes(line, [6])).toThrow(RangeError);
    expect(() => splitTimes(line, [4, 2])).toThrow(RangeError);
    expect(() => splitTimes(line, [])).toThrow(RangeError);
  });

  it('validates cut lists', () => {
    expect(validCuts(6, [1, 5])).toBe(true);
    expect(validCuts(6, [3, 3])).toBe(false);
    expect(validCuts(6, [1.5])).toBe(false);
  });
});
