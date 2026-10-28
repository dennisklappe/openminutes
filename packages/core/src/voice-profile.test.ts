import { describe, expect, it } from 'vitest';
import { LANGUAGE_PENALTY } from './voice-language.js';
import {
  buildPrototypes,
  buildProfile,
  PROTOTYPE_CEILING,
  profileScore,
  pruneProfile,
  PRUNE_AFTER_MS,
} from './voice-profile.js';

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

  it('has no fixed number of vectors: every different way of sounding gets its own', () => {
    const many = [0, 60, 120, 180, 240, 300].map((degrees) => sample(degrees));
    expect(buildPrototypes(many)).toHaveLength(6);
  });

  it('joins a sample to the closest vector at the merge similarity and not below it', () => {
    const near = [sample(0), sample(50)];
    expect(buildPrototypes(near, { mergeSimilarity: 0.6 })).toHaveLength(1);
    expect(buildPrototypes(near, { mergeSimilarity: 0.7 })).toHaveLength(2);
  });

  it('joins the closest vector when several are close enough', () => {
    const prototypes = buildPrototypes([sample(0), sample(80), sample(60)], {
      mergeSimilarity: 0.5,
    });
    expect(prototypes.map((p) => p.samples)).toEqual([1, 2]);
  });

  it('keeps a safety ceiling by merging the two closest vectors', () => {
    const angles = Array.from({ length: 12 }, (_, i) => i * 30 + (i % 2) * 2);
    const built = buildPrototypes(
      angles.map((a) => sample(a)),
      {
        mergeSimilarity: 0.99,
        ceiling: 5,
      },
    );
    expect(built).toHaveLength(5);
    expect(built.reduce((sum, p) => sum + p.samples, 0)).toBe(12);
    expect(PROTOTYPE_CEILING).toBe(30);
  });

  it('carries the usage counts over to the vector that comes out closest', () => {
    const previous = [
      {
        vector: angle(0),
        samples: 3,
        language: 'und',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastMatchedAt: '2026-02-01T00:00:00.000Z',
        matches: 4,
        rejectedMatches: 1,
      },
    ];
    const [kept, fresh] = buildPrototypes([sample(0), sample(5), sample(120)], { previous });
    expect(kept).toMatchObject({
      createdAt: previous[0]?.createdAt,
      matches: 4,
      rejectedMatches: 1,
    });
    expect(fresh?.createdAt).toBeUndefined();
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

  it('builds separate vectors for each language', () => {
    const prototypes = buildPrototypes([
      ...[0, 90, 180].map((d) => dutch(d)),
      ...[0, 90].map((d) => english(d)),
    ]);
    expect(prototypes.filter((p) => p.language === 'nl')).toHaveLength(3);
    expect(prototypes.filter((p) => p.language === 'en')).toHaveLength(2);
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

describe('pruneProfile', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');
  const old = new Date(now.getTime() - PRUNE_AFTER_MS - 1000).toISOString();
  const recent = new Date(now.getTime() - 1000).toISOString();
  const previous = (extra: object, degrees: number) => ({
    vector: angle(degrees),
    samples: 1,
    language: 'und',
    createdAt: old,
    ...extra,
  });
  const run = (prototypes: ReturnType<typeof previous>[]) =>
    pruneProfile(
      buildProfile(
        prototypes.map((p, i) => sample(i * 90)),
        { previous: prototypes },
      ),
      now,
    );

  it('drops a small vector that has not matched anything for a long time', () => {
    const { prototypes, dropped } = run([previous({}, 0), previous({ lastMatchedAt: recent }, 90)]);
    expect(prototypes).toHaveLength(1);
    expect(dropped).toEqual([0]);
  });

  it('drops a small vector that only matched lines the owner turned down', () => {
    const { prototypes } = run([
      previous({ createdAt: recent, rejectedMatches: 2 }, 0),
      previous({ createdAt: recent, matches: 1, rejectedMatches: 1 }, 90),
    ]);
    expect(prototypes).toHaveLength(1);
  });

  it('keeps a recent unmatched vector and a vector with more than two samples', () => {
    const big = [sample(0), sample(2), sample(4)];
    const built = buildProfile([...big, sample(90)], {
      previous: [previous({}, 0), previous({ createdAt: recent }, 90)],
    });
    expect(pruneProfile(built, now).dropped).toEqual([]);
  });

  it('never prunes a vector without a creation time', () => {
    const built = buildProfile([sample(0)]);
    expect(pruneProfile(built, now).dropped).toEqual([]);
  });
});
