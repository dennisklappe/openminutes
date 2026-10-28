import type { VoicePrototype } from '@openminutes/db';
import { cosineSimilarity } from './voices.js';
import { isKnownLanguage, LANGUAGE_PENALTY, normalizeLanguage } from './voice-language.js';

/** A sample joins an existing vector when it is at least this similar to it (the setting default). */
export const PROTOTYPE_MERGE_SIMILARITY = 0.6;

/** Hidden safety ceiling: beyond this many vectors per language the two closest are merged. */
export const PROTOTYPE_CEILING = 30;

/** A vector of at most this many samples that matched nothing for this long is pruned. */
export const PRUNE_AFTER_MS = 120 * 24 * 60 * 60 * 1000;
export const PRUNE_MAX_SAMPLES = 2;

export interface ProfileSample {
  embedding: readonly number[];
  /** How many earlier samples the vector stands for, 1 for a single line. */
  weight: number;
  /** The language spoken. Missing: unknown. */
  language?: string | undefined;
}

export interface BuildOptions {
  /** Cosine at which a sample joins the closest vector. */
  mergeSimilarity?: number;
  /** Most vectors per language, the two closest are merged beyond it. */
  ceiling?: number;
  /** The profile as it was, to carry the usage counts of each vector over. */
  previous?: readonly VoicePrototype[];
}

/** The vectors of a profile and, per vector, the indexes of the input samples it is made of. */
export interface BuiltProfile {
  prototypes: VoicePrototype[];
  members: number[][];
}

const normalize = (vector: readonly number[]): number[] => {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return length === 0 ? [...vector] : vector.map((value) => value / length);
};

/** The vector length most samples have, the newest winning a tie, so a model change does not mix. */
function currentDimension(samples: readonly ProfileSample[]): number {
  const counts = new Map<number, number>();
  for (const { embedding } of samples) {
    counts.set(embedding.length, (counts.get(embedding.length) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const { embedding } of samples) {
    const count = counts.get(embedding.length) ?? 0;
    if (count >= bestCount) {
      best = embedding.length;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Builds the voice profile from the samples, oldest first, one vector per way of sounding: each
 * sample joins the closest vector of its language when it is at least `mergeSimilarity` like it,
 * else it starts a new one. A vector is the length-normalised, weight-averaged direction of its
 * samples. There is no fixed number of vectors, only a safety ceiling per language. The result
 * depends only on the samples (and the usage counts carried over), so removing one and building
 * again gives the profile without it.
 */
export function buildProfile(
  samples: readonly ProfileSample[],
  options: BuildOptions = {},
): BuiltProfile {
  const languages = [...new Set(samples.map((s) => normalizeLanguage(s.language)))].sort();
  const built = languages.map((language) => {
    const own = samples.flatMap((sample, index) =>
      normalizeLanguage(sample.language) === language ? [{ sample, index }] : [],
    );
    return buildForLanguage(own, language, options);
  });
  return {
    prototypes: built.flatMap((b) => b.prototypes),
    members: built.flatMap((b) => b.members),
  };
}

export const buildPrototypes = (samples: readonly ProfileSample[], options: BuildOptions = {}) =>
  buildProfile(samples, options).prototypes;

interface Group {
  sum: number[];
  samples: number;
  members: number[];
}

function buildForLanguage(
  own: readonly { sample: ProfileSample; index: number }[],
  language: string,
  {
    mergeSimilarity = PROTOTYPE_MERGE_SIMILARITY,
    ceiling = PROTOTYPE_CEILING,
    previous = [],
  }: BuildOptions,
): BuiltProfile {
  const dimension = currentDimension(own.map((o) => o.sample));
  const groups: Group[] = [];
  const nearest = (direction: readonly number[], among: readonly Group[]) => {
    let best = -1;
    let bestScore = -Infinity;
    for (const [i, group] of among.entries()) {
      const score = cosineSimilarity(group.sum, direction);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    return { best, score: bestScore };
  };
  for (const { sample, index } of own) {
    if (sample.embedding.length !== dimension || dimension === 0) continue;
    const direction = normalize(sample.embedding);
    const { best, score } = nearest(direction, groups);
    const target = groups[best];
    if (target && score >= mergeSimilarity) {
      target.sum = target.sum.map((value, i) => value + (direction[i] ?? 0) * sample.weight);
      target.samples += sample.weight;
      target.members.push(index);
    } else {
      groups.push({
        sum: direction.map((value) => value * sample.weight),
        samples: sample.weight,
        members: [index],
      });
    }
  }
  while (groups.length > Math.max(1, ceiling)) mergeClosest(groups);
  const before = prototypesIn(previous, language);
  return {
    prototypes: groups.map((group) => {
      const vector = normalize(group.sum);
      const origin = before
        .map((p) => ({ p, score: cosineSimilarity(vector, p.vector) }))
        .filter((c) => c.score >= mergeSimilarity)
        .toSorted((a, b) => b.score - a.score)[0]?.p;
      return {
        vector,
        samples: group.samples,
        language,
        ...(origin?.createdAt !== undefined && { createdAt: origin.createdAt }),
        ...(origin?.lastMatchedAt !== undefined && { lastMatchedAt: origin.lastMatchedAt }),
        ...(origin?.matches !== undefined && { matches: origin.matches }),
        ...(origin?.rejectedMatches !== undefined && { rejectedMatches: origin.rejectedMatches }),
      };
    }),
    members: groups.map((group) => group.members),
  };
}

/** Joins the two most alike vectors into one, in place. */
function mergeClosest(groups: Group[]): void {
  let a = 0;
  let b = 1;
  let best = -Infinity;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const score = cosineSimilarity(groups[i]?.sum ?? [], groups[j]?.sum ?? []);
      if (score > best) {
        best = score;
        a = i;
        b = j;
      }
    }
  }
  const left = groups[a];
  const right = groups[b];
  if (!left || !right) return;
  left.sum = left.sum.map((value, i) => value + (right.sum[i] ?? 0));
  left.samples += right.samples;
  left.members.push(...right.members);
  groups.splice(b, 1);
}

/**
 * Takes out the vectors that are not worth keeping: made of one or two samples and either not
 * matched by any line for PRUNE_AFTER_MS, or matched only by lines the owner turned down. A vector
 * without a creation time is new to the bookkeeping and stays. `dropped` lists the input samples
 * of the removed vectors, which the caller leaves out of the profile from then on.
 */
export function pruneProfile(
  built: BuiltProfile,
  now: Date,
): { prototypes: VoicePrototype[]; dropped: number[] } {
  const prototypes: VoicePrototype[] = [];
  const dropped: number[] = [];
  for (const [i, prototype] of built.prototypes.entries()) {
    const members = built.members[i] ?? [];
    const idleSince = Date.parse(prototype.lastMatchedAt ?? prototype.createdAt ?? '');
    const idle = Number.isFinite(idleSince) && now.getTime() - idleSince > PRUNE_AFTER_MS;
    const onlyRejected = (prototype.matches ?? 0) === 0 && (prototype.rejectedMatches ?? 0) > 0;
    if (members.length <= PRUNE_MAX_SAMPLES && (idle || onlyRejected)) dropped.push(...members);
    else prototypes.push(prototype);
  }
  return { prototypes, dropped };
}

/** The vectors of a profile in one language. */
export const prototypesIn = (prototypes: readonly VoicePrototype[], language: string) =>
  prototypes.filter((p) => normalizeLanguage(p.language) === normalizeLanguage(language));

/**
 * How well a voice fits a profile: the highest cosine over the vectors, 0 for an empty profile.
 * With a known language the vectors of that language count; a person with none in that language
 * is scored against the vectors of the other languages, minus LANGUAGE_PENALTY.
 */
export function profileScore(
  embedding: readonly number[],
  prototypes: readonly VoicePrototype[],
  language?: string | null,
): number {
  const best = (list: readonly VoicePrototype[]) =>
    Math.max(0, ...list.map((p) => cosineSimilarity(embedding, p.vector)));
  if (!isKnownLanguage(language)) return best(prototypes);
  const same = prototypesIn(prototypes, normalizeLanguage(language));
  if (same.length > 0) return best(same);
  return Math.max(0, best(prototypes) - LANGUAGE_PENALTY);
}
