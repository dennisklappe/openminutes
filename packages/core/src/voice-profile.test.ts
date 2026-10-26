import { describe, expect, it } from 'vitest';
import { buildPrototypes, MAX_PROTOTYPES, profileScore } from './voice-profile.js';

const angle = (degrees: number): number[] => [
  Math.cos((degrees * Math.PI) / 180),
  Math.sin((degrees * Math.PI) / 180),
];
const sample = (degrees: number, weight = 1) => ({ embedding: angle(degrees), weight });

describe('buildPrototypes', () => {
  it('keeps similar samples in one vector and counts them', () => {
    const [only, ...rest] = buildPrototypes([sample(0), sample(10), sample(20)]);
    expect(rest).toEqual([]);
    expect(only?.samples).toBe(3);
    expect(Math.hypot(...(only?.vector ?? []))).toBeCloseTo(1);
  });

  it('starts a new vector for a different way of sounding', () => {
    const prototypes = buildPrototypes([sample(0), sample(90), sample(5)]);
    expect(prototypes.map((p) => p.samples)).toEqual([2, 1]);
  });

  it('never keeps more than five vectors', () => {
    const many = [0, 72, 144, 216, 288, 36, 108, 180].map((degrees) => sample(degrees));
    expect(buildPrototypes(many)).toHaveLength(MAX_PROTOTYPES);
  });

  it('weighs imported vectors by the samples they stand for', () => {
    const [prototype] = buildPrototypes([sample(0, 9), sample(40, 1)]);
    const degrees =
      (Math.atan2(prototype?.vector[1] ?? 0, prototype?.vector[0] ?? 1) * 180) / Math.PI;
    expect(degrees).toBeLessThan(10);
    expect(prototype?.samples).toBe(10);
  });

  it('is the same without a removed sample as when it was never added', () => {
    const kept = [sample(0), sample(5)];
    const withBad = [sample(0), sample(170), sample(5)];
    expect(buildPrototypes(withBad.filter((s) => s !== withBad[1]))).toEqual(buildPrototypes(kept));
    expect(buildPrototypes([])).toEqual([]);
  });

  it('ignores vectors of another size than the newest model made', () => {
    const prototypes = buildPrototypes([{ embedding: [1, 0, 0], weight: 1 }, sample(0), sample(3)]);
    expect(prototypes).toHaveLength(1);
    expect(prototypes[0]?.vector).toHaveLength(2);
  });
});

describe('profileScore', () => {
  it('matches by the best vector, not by their mean', () => {
    const prototypes = buildPrototypes([sample(0), sample(90)]);
    expect(profileScore(angle(90), prototypes)).toBeCloseTo(1);
    expect(profileScore(angle(0), prototypes)).toBeCloseTo(1);
    expect(profileScore(angle(45), prototypes)).toBeCloseTo(Math.SQRT1_2);
  });

  it('is zero for an empty profile', () => {
    expect(profileScore([1, 0], [])).toBe(0);
  });
});
