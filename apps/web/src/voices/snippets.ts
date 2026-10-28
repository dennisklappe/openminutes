import type { VoiceSnippetDto } from '../dto.js';

const MIN_MS = 2_000;
const MAX_MS = 12_000;
const MIN_GAP_MS = 20_000;
const MAX_SNIPPETS = 3;

export const isClean = (text: string) => text.trim().length >= 12 && /\p{L}{2}/u.test(text);

export function pickSnippets(segments: readonly VoiceSnippetDto[]): VoiceSnippetDto[] {
  const candidates = segments
    .filter(
      (s) => s.endMs - s.startMs >= MIN_MS && s.endMs - s.startMs <= MAX_MS && isClean(s.text),
    )
    .sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs) || a.startMs - b.startMs);
  const picked: VoiceSnippetDto[] = [];
  for (const spread of [true, false]) {
    for (const candidate of candidates) {
      if (picked.length === MAX_SNIPPETS) break;
      if (picked.includes(candidate)) continue;
      if (spread && picked.some((p) => Math.abs(p.startMs - candidate.startMs) < MIN_GAP_MS)) {
        continue;
      }
      picked.push(candidate);
    }
  }
  return picked
    .sort((a, b) => a.startMs - b.startMs)
    .map(({ startMs, endMs, text }) => ({ startMs, endMs, text: text.trim() }));
}
