import type { VoicePrototype } from '@openminutes/db';
import { cosineSimilarity } from './voices.js';

/** A person's voice is kept as at most this many vectors, one per way they sound. */
export const MAX_PROTOTYPES = 5;

/** A sample joins an existing vector when it is at least this similar to it. */
export const PROTOTYPE_JOIN_SIMILARITY = 0.6;

export interface ProfileSample {
  embedding: readonly number[];
  /** How many earlier samples the vector stands for, 1 for a single line. */
  weight: number;
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
 * Builds the voice profile from the samples, oldest first: each sample joins the closest vector
 * when it is similar enough or there is no room for another, else it starts a new one. A vector
 * is the length-normalised, weight-averaged direction of its samples. The result depends only on
 * the samples, so removing one and building again gives the profile without it.
 */
export function buildPrototypes(samples: readonly ProfileSample[]): VoicePrototype[] {
  const dimension = currentDimension(samples);
  const groups: { sum: number[]; samples: number }[] = [];
  for (const sample of samples) {
    if (sample.embedding.length !== dimension || dimension === 0) continue;
    const direction = normalize(sample.embedding);
    let nearest = -1;
    let nearestScore = -Infinity;
    for (const [i, group] of groups.entries()) {
      const score = cosineSimilarity(group.sum, direction);
      if (score > nearestScore) {
        nearest = i;
        nearestScore = score;
      }
    }
    const target = groups[nearest];
    if (target && (nearestScore >= PROTOTYPE_JOIN_SIMILARITY || groups.length >= MAX_PROTOTYPES)) {
      target.sum = target.sum.map((value, i) => value + (direction[i] ?? 0) * sample.weight);
      target.samples += sample.weight;
    } else {
      groups.push({ sum: direction.map((value) => value * sample.weight), samples: sample.weight });
    }
  }
  return groups.map((group) => ({ vector: normalize(group.sum), samples: group.samples }));
}

/** How well a voice fits a profile: the highest cosine over the vectors, 0 for an empty profile. */
export function profileScore(
  embedding: readonly number[],
  prototypes: readonly VoicePrototype[],
): number {
  return Math.max(0, ...prototypes.map((p) => cosineSimilarity(embedding, p.vector)));
}
