import type { VoiceSuggestionDto } from '../dto.js';

const GENERIC = /^Speaker \d+$/;

export const isGenericName = (name: string) => GENERIC.test(name);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function replaceName(text: string, from: string, to: string): string {
  if (from === to || from === '') return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escape(from)}(?![\\p{L}\\p{N}_])`, 'gu');
  return text.replace(pattern, () => to);
}

export function mergeSuggestions(
  lists: readonly (readonly VoiceSuggestionDto[])[],
  exclude: string,
): VoiceSuggestionDto[] {
  const seen = new Set([exclude.toLowerCase()]);
  const merged: VoiceSuggestionDto[] = [];
  for (const suggestion of lists.flat()) {
    const name = suggestion.name.trim();
    const key = name.toLowerCase();
    if (name === '' || seen.has(key)) continue;
    seen.add(key);
    merged.push({ name, source: suggestion.source });
  }
  return merged;
}
