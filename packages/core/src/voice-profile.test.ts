import { describe, expect, it } from 'vitest';
import { LANGUAGE_PENALTY } from './voice-language.js';
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

describe('voice profiles per language', () => {
  const dutch = (degrees: number, weight = 1) => ({ ...sample(degrees, weight), language: 'nl' });
  const english = (degrees: number, weight = 1) => ({ ...sample(degrees, weight), language: 'en' });

  it('builds separate vectors for each language, up to five each', () => {
    const many = [0, 72, 144, 216, 288, 36, 108, 180];
    const prototypes = buildPrototypes([
      ...many.map((d) => dutch(d)),
      ...many.map((d) => english(d)),
    ]);
    expect(prototypes.filter((p) => p.language === 'nl')).toHaveLength(MAX_PROTOTYPES);
    expect(prototypes.filter((p) => p.language === 'en')).toHaveLength(MAX_PROTOTYPES);
  });

  it('does not mix a Dutch and an English sample of the same direction', () => {
    const prototypes = buildPrototypes([dutch(0), english(0), sample(0)]);
    expect(prototypes.map((p) => [p.language, p.samples])).toEqual([
      ['en', 1],
      ['nl', 1],
      ['und', 1],
    ]);
  });

  it('scores against the same language first', () => {
    const prototypes = buildPrototypes([dutch(0), english(90)]);
    // The voice sounds like the English vector, but this line is Dutch: only Dutch counts.
    expect(profileScore(angle(90), prototypes, 'nl')).toBeCloseTo(0);
    expect(profileScore(angle(0), prototypes, 'nl')).toBeCloseTo(1);
    expect(profileScore(angle(90), prototypes, 'en')).toBeCloseTo(1);
  });

  it('falls back to the other languages with a small penalty', () => {
    const prototypes = buildPrototypes([dutch(0)]);
    expect(profileScore(angle(0), prototypes, 'en')).toBeCloseTo(1 - LANGUAGE_PENALTY);
    expect(profileScore(angle(0), prototypes, 'en-GB')).toBeCloseTo(1 - LANGUAGE_PENALTY);
  });

  it('compares with everything when the language is not known', () => {
    const prototypes = buildPrototypes([dutch(0), english(90)]);
    expect(profileScore(angle(90), prototypes)).toBeCloseTo(1);
    expect(profileScore(angle(90), prototypes, 'und')).toBeCloseTo(1);
  });

  it('treats a profile saved before languages as unknown language', () => {
    const old = [{ vector: angle(0), samples: 3 }];
    expect(profileScore(angle(0), old, 'nl')).toBeCloseTo(1 - LANGUAGE_PENALTY);
    expect(profileScore(angle(0), old)).toBeCloseTo(1);
  });
});
