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
}

export function matchVoices(
  embedding: readonly number[],
  known: readonly KnownVoice[],
  threshold = VOICE_MATCH_THRESHOLD,
): { name: string; score: number }[] {
  const best = new Map<string, number>();
  for (const voice of known) {
    const score = cosineSimilarity(embedding, voice.embedding);
    if (score >= threshold && score > (best.get(voice.name) ?? -Infinity)) {
      best.set(voice.name, score);
    }
  }
  return [...best].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score);
}
