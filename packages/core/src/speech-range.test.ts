import { describe, expect, it } from 'vitest';
import { detectSpeechRange, shiftToRange } from './speech-range.js';

describe('detectSpeechRange', () => {
  it('keeps two seconds of padding around the first and last speech', () => {
    const segments = [
      { startMs: 89_000, endMs: 95_000 },
      { startMs: 200_000, endMs: 250_000 },
    ];
    expect(detectSpeechRange(segments, 330_000)).toEqual({ startMs: 87_000, endMs: 252_000 });
  });

  it('prefers word times over the padded segment times', () => {
    const segments = [
      {
        startMs: 80_000,
        endMs: 120_000,
        words: [
          { startMs: 90_000, endMs: 90_500 },
          { startMs: 110_000, endMs: 111_000 },
        ],
      },
    ];
    expect(detectSpeechRange(segments, 200_000)).toEqual({ startMs: 88_000, endMs: 113_000 });
  });

  it('trims only the side that has enough silence', () => {
    expect(detectSpeechRange([{ startMs: 40_000, endMs: 99_500 }], 100_000)).toEqual({
      startMs: 38_000,
      endMs: 100_000,
    });
  });

  it('does nothing without speech, without a duration or when there is nothing to cut', () => {
    expect(detectSpeechRange([], 100_000)).toBeNull();
    expect(detectSpeechRange([{ startMs: 0, endMs: 1000 }], 0)).toBeNull();
    expect(detectSpeechRange([{ startMs: 500, endMs: 99_800 }], 100_000)).toBeNull();
  });
});

describe('shiftToRange', () => {
  it('makes times relative to the range and clamps them inside it', () => {
    const range = { startMs: 87_000, endMs: 252_000 };
    expect(shiftToRange(89_000, range)).toBe(2000);
    expect(shiftToRange(80_000, range)).toBe(0);
    expect(shiftToRange(300_000, range)).toBe(165_000);
  });
});
