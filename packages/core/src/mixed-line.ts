import { cosineSimilarity } from './voices.js';

/**
 * A transcript line sometimes holds two speakers, for example a short "Waarvoor?" by one person
 * and the rest by another. Training a voice on such a line pollutes the profile, so before a line
 * becomes a voice sample its two halves are compared: one voice says alike things in both halves,
 * two voices do not.
 */

/** Only lines at least this long are checked, a shorter line has no halves worth comparing. */
export const GUARD_MIN_LINE_MS = 4000;
/** Each half must be at least this long, a shorter print cannot tell speakers apart. */
export const GUARD_MIN_HALF_MS = 1500;
/**
 * Halves of one line that score under this cosine are probably two speakers. Chosen from the
 * other thresholds on the same eres2net prints: two prints are called the same voice from 0.6
 * (recording speakers) and a saved voice matches from 0.55. Halves are short, so the prints are
 * noisier and genuine same-speaker halves dip lower, hence a lower bar here: a false alarm only
 * costs one skipped sample, a miss trains a profile with the wrong voice. Not tuned on real audio.
 */
export const GUARD_SAME_VOICE = 0.45;

export interface HalfRange {
  startMs: number;
  endMs: number;
}

/** The first and second half of a line, undefined when the line or a half is too short. */
export function halfRanges(
  startMs: number,
  endMs: number,
): { first: HalfRange; second: HalfRange } | undefined {
  const duration = endMs - startMs;
  if (duration < GUARD_MIN_LINE_MS || duration / 2 < GUARD_MIN_HALF_MS) return undefined;
  const middle = Math.round(startMs + duration / 2);
  return { first: { startMs, endMs: middle }, second: { startMs: middle, endMs } };
}

/** Whether the voice prints of the two halves are of one voice. Unknown prints agree. */
export function halvesAgree(
  first: readonly number[] | null | undefined,
  second: readonly number[] | null | undefined,
): boolean {
  if (!first || !second || first.length === 0 || first.length !== second.length) return true;
  return cosineSimilarity(first, second) >= GUARD_SAME_VOICE;
}

/** The line is probably two speakers: both halves have a print and they disagree. */
export const isProbablyMixed = (
  first: readonly number[] | null | undefined,
  second: readonly number[] | null | undefined,
): boolean => !halvesAgree(first, second);
