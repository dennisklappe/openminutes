/**
 * Voices that grow by themselves, with guardrails so a wrong first guess can never bootstrap a
 * profile and a drifting profile cannot run away. Every number here is a limit on that.
 */

/** A language needs this much speech verified by a person before anything is added by itself. */
export const AUTO_SEED_MS = 30_000;
/** The voice check score of a line against its own profile must be at least this. */
export const AUTO_MIN_SCORE = 0.8;
/** ... and this far ahead of the best other voice in the meeting. Raised per person on a rejection. */
export const AUTO_MARGIN = 0.25;
/** The speaker indicator or diarization must be at least this sure of the label. */
export const AUTO_MIN_TIMING_CONFIDENCE = 0.9;
/** Only lines of at least this length are learned by themselves. */
export const AUTO_MIN_LINE_MS = 3000;
/** Auto speech may be at most this many times the verified speech of the profile. */
export const AUTO_RATIO = 3;
/** The most auto speech one meeting adds to one person. */
export const AUTO_PER_MEETING_MS = 60_000;
/** An auto sample counts this much of a verified one when the profile is built. */
export const AUTO_SAMPLE_WEIGHT = 0.4;
/** What a rejected auto sample adds to that person's required margin, and the most it can reach. */
export const AUTO_MARGIN_STEP = 0.02;
export const AUTO_MARGIN_MAX = 0.15;

/** What a profile counts for when asking whether it is good enough. */
export const effectiveMs = (verifiedMs: number, autoMs: number) =>
  verifiedMs + AUTO_SAMPLE_WEIGHT * autoMs;
