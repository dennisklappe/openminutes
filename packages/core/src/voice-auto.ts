/**
 * A voice sample enters a profile only after the owner reviewed it, or when two independent
 * proofs agree: the call's speaking indicator names the person and the voice matches their
 * profile (call labels), or the voice is clearly not the other person of a two person meeting
 * (1:1 elimination). Every number here is a starting value that real audio has not tuned.
 */

/** A language needs this much speech verified by a person before the voice counts as a proof. */
export const AUTO_SEED_MS = 30_000;
/** The voice must lead the best other voice in the meeting by this much. Raised per person on a rejection. */
export const AUTO_MARGIN = 0.1;
/** The speaker indicator or diarization must be at least this sure of the label. */
export const AUTO_MIN_TIMING_CONFIDENCE = 0.9;
/** Only lines of at least this length are learned by themselves. */
export const AUTO_MIN_LINE_MS = 4000;
/** The indicator names exactly one person: no other candidate on the line scores more than this. */
export const AUTO_MAX_RIVAL_TIMING = 0.05;
/** 1:1 elimination: the voice must be this far under the agree threshold of the other person. */
export const ELIMINATION_GAP = 0.15;
/** A third voice: another cluster of the lines that are not the ready person, this big, stops 1:1 elimination. */
export const ELIMINATION_THIRD_VOICE_MIN_LINES = 3;
export const ELIMINATION_THIRD_VOICE_MIN_MS = 12_000;
/** Environment card: the voice does not match the profile for at least this share of its speech. */
export const ENV_MISMATCH_SHARE = 0.6;
/** ... and has at least this much clean speech and so many lines, so a short visit asks nothing. */
export const ENV_MIN_MS = 30_000;
export const ENV_MIN_LINES = 5;
/** Lines shown on the card to play, and lines that become samples when the owner says it is them. */
export const ENV_PLAY_LINES = 4;
export const ENV_LEARN_LINES = 6;
/** An auto sample counts this much of a verified one when the profile is built. */
export const AUTO_SAMPLE_WEIGHT = 0.4;
/** What a rejected auto sample adds to that person's required margin, and the most it can reach. */
export const AUTO_MARGIN_STEP = 0.02;
export const AUTO_MARGIN_MAX = 0.15;

/** What a profile counts for when asking whether it is good enough. */
export const effectiveMs = (verifiedMs: number, autoMs: number) =>
  verifiedMs + AUTO_SAMPLE_WEIGHT * autoMs;
