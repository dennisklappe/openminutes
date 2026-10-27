import { describe, expect, it } from 'vitest';
import {
  GUARD_MIN_HALF_MS,
  GUARD_MIN_LINE_MS,
  GUARD_SAME_VOICE,
  halfRanges,
  halvesAgree,
  isProbablyMixed,
} from './mixed-line.js';

describe('halfRanges', () => {
  it('splits a long line in two halves that meet in the middle', () => {
    expect(halfRanges(1000, 7000)).toEqual({
      first: { startMs: 1000, endMs: 4000 },
      second: { startMs: 4000, endMs: 7000 },
    });
  });

  it('skips lines under the minimum length and accepts the minimum itself', () => {
    expect(halfRanges(0, GUARD_MIN_LINE_MS - 1)).toBeUndefined();
    expect(halfRanges(0, GUARD_MIN_LINE_MS)).toBeDefined();
    expect(GUARD_MIN_LINE_MS / 2).toBeGreaterThanOrEqual(GUARD_MIN_HALF_MS);
  });
});

describe('the cosine guard', () => {
  it('lets halves of one voice agree', () => {
    expect(halvesAgree([1, 0.1, 0], [0.9, 0.2, 0.05])).toBe(true);
    expect(isProbablyMixed([1, 0.1, 0], [0.9, 0.2, 0.05])).toBe(false);
  });

  it('flags halves of different voices', () => {
    expect(isProbablyMixed([1, 0, 0], [0, 1, 0])).toBe(true);
    expect(isProbablyMixed([1, 0], [-1, 0.1])).toBe(true);
  });

  it('treats a cosine exactly at the threshold as one voice', () => {
    const angle = Math.acos(GUARD_SAME_VOICE);
    const edge = [Math.cos(angle), Math.sin(angle)];
    expect(
      halvesAgree(
        [1, 0],
        edge.map((v) => v + 1e-9),
      ),
    ).toBe(true);
    expect(
      halvesAgree([1, 0], [GUARD_SAME_VOICE - 0.01, Math.sqrt(1 - (GUARD_SAME_VOICE - 0.01) ** 2)]),
    ).toBe(false);
  });

  it('never flags when a print is missing or the sizes differ', () => {
    expect(isProbablyMixed(null, [1, 0])).toBe(false);
    expect(isProbablyMixed([1, 0], undefined)).toBe(false);
    expect(isProbablyMixed([1, 0], [0, 1, 0])).toBe(false);
    expect(isProbablyMixed([], [])).toBe(false);
  });
});
