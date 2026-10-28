import { describe, expect, it } from 'vitest';
import { TUNING_FIELDS, clampAll, clampTuning, tuningIsDefault } from './voiceTuning.js';

const defaults = {
  readySeconds: 120,
  readyMeetings: 5,
  readyWays: 5,
  agreeScore: 0.6,
  mergeSimilarity: 0.6,
};
const field = (key: string) => {
  const found = TUNING_FIELDS.find((f) => f.key === key);
  if (!found) throw new Error(key);
  return found;
};

describe('voice tuning', () => {
  it('clamps each value to its range', () => {
    expect(clampTuning(field('readySeconds'), 5)).toBe(10);
    expect(clampTuning(field('readySeconds'), 9000)).toBe(3600);
    expect(clampTuning(field('readyMeetings'), 2.6)).toBe(3);
    expect(clampTuning(field('readyWays'), 99)).toBe(30);
    expect(clampTuning(field('agreeScore'), 0.1)).toBe(0.2);
    expect(clampTuning(field('mergeSimilarity'), 0.999)).toBe(0.95);
    expect(clampTuning(field('agreeScore'), 0.456)).toBe(0.46);
  });

  it('clamps a whole set and falls back to the default for junk', () => {
    expect(clampAll({ ...defaults, readyWays: 0, agreeScore: Number.NaN }, defaults)).toEqual({
      ...defaults,
      readyWays: 1,
    });
  });

  it('knows when everything is at the default', () => {
    expect(tuningIsDefault(defaults, defaults)).toBe(true);
    expect(tuningIsDefault({ ...defaults, readyMeetings: 6 }, defaults)).toBe(false);
  });
});
