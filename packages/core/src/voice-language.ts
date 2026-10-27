/** A voice is kept per language: the same person sounds different in Dutch and in English. */
export const UNKNOWN_LANGUAGE = 'und';

/**
 * What a voice score loses when the only profile is in another language. Small, because it is
 * still the same voice, but a profile in the right language must win a tie.
 */
export const LANGUAGE_PENALTY = 0.05;

/** A two letter lower case code: "en-US" and "EN" become "en", nothing or "auto" becomes "und". */
export function normalizeLanguage(code: string | null | undefined): string {
  const base = (code ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return /^[a-z]{2,3}$/.test(base) && base !== 'auto' ? base : UNKNOWN_LANGUAGE;
}

export const isKnownLanguage = (code: string | null | undefined) =>
  normalizeLanguage(code) !== UNKNOWN_LANGUAGE;
