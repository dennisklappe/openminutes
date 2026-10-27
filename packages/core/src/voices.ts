import { isKnownLanguage, LANGUAGE_PENALTY, normalizeLanguage } from './voice-language.js';

export const VOICE_MATCH_THRESHOLD = 0.55;

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

export function mergeEmbeddings(
  current: readonly number[],
  currentSamples: number,
  added: readonly number[],
): number[] {
  return current.map(
    (value, i) => (value * currentSamples + (added[i] ?? 0)) / (currentSamples + 1),
  );
}

/** A name can have several vectors, it then counts with the best of them. */
interface KnownVoice {
  name: string;
  embedding: readonly number[];
  /** The language of the vector. Missing: unknown. */
  language?: string | undefined;
}

export function matchVoices(
  embedding: readonly number[],
  known: readonly KnownVoice[],
  threshold = VOICE_MATCH_THRESHOLD,
  language?: string | null,
): { name: string; score: number }[] {
  const wanted = normalizeLanguage(language);
  const inLanguage = new Set(
    isKnownLanguage(wanted)
      ? known.filter((voice) => normalizeLanguage(voice.language) === wanted).map((v) => v.name)
      : [],
  );
  const best = new Map<string, number>();
  for (const voice of known) {
    const own = normalizeLanguage(voice.language) === wanted;
    // A name with a vector in this language is matched on those; the others only fill in when it has none.
    if (isKnownLanguage(wanted) && inLanguage.has(voice.name) !== own) continue;
    const score =
      cosineSimilarity(embedding, voice.embedding) -
      (isKnownLanguage(wanted) && !own ? LANGUAGE_PENALTY : 0);
    if (score >= threshold && score > (best.get(voice.name) ?? -Infinity)) {
      best.set(voice.name, score);
    }
  }
  return [...best].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score);
}
