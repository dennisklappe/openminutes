import type { CheckSampleDto } from '../dto.js';
import { isFiller } from '../people/useful.js';
import { isClean } from '../voices/snippets.js';

const MIN_MS = 3_000;
const MAX_MS = 12_000;
const MIN_GAP_MS = 20_000;
export const MAX_SAMPLES = 3;

interface Line extends CheckSampleDto {
  mixed: 'marked' | 'probable' | null;
}

/**
 * The lines of one voice worth listening to: the longest clean single-speaker lines of 3 to 12
 * seconds, spread over the meeting where it is long enough, in meeting order.
 */
export function pickSamples(lines: readonly Line[]): CheckSampleDto[] {
  const candidates = lines
    .filter(
      (line) =>
        !line.mixed &&
        line.endMs - line.startMs >= MIN_MS &&
        line.endMs - line.startMs <= MAX_MS &&
        isClean(line.text) &&
        !isFiller(line.text),
    )
    .sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs) || a.startMs - b.startMs);
  const picked: Line[] = [];
  for (const spread of [true, false]) {
    for (const candidate of candidates) {
      if (picked.length === MAX_SAMPLES) break;
      if (picked.includes(candidate)) continue;
      if (spread && picked.some((p) => Math.abs(p.startMs - candidate.startMs) < MIN_GAP_MS)) {
        continue;
      }
      picked.push(candidate);
    }
  }
  return picked
    .sort((a, b) => a.startMs - b.startMs)
    .map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text: text.trim() }));
}
