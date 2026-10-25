import type { Speech } from './silence-gate.js';

const MIN_SEGMENTS = 8;
const REPEAT_SHARE = 0.6;
const TOP_TEXTS = 3;
const MIN_REPEATS = 3;
const WINDOW_MS = 30_000;
const WINDOW_TOLERANCE_MS = 1500;
const WINDOW_SHARE = 0.5;
const SHORT_MS = 4000;

const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const median = (values: number[]) => values.toSorted((a, b) => a - b)[values.length >> 1] ?? 0;

/** A few lines said over and over, which no conversation does. */
function isRepeated(segments: readonly Speech[]): boolean {
  const counts = new Map<string, number>();
  for (const { text } of segments) {
    const line = plain(text);
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const top = [...counts.values()].toSorted((a, b) => b - a).slice(0, TOP_TEXTS);
  // A handful of different lines is not repetition: the top lines must actually come back.
  return (
    (top[0] ?? 0) >= MIN_REPEATS &&
    top.reduce((sum, count) => sum + count, 0) >= segments.length * REPEAT_SHARE
  );
}

/**
 * Whisper that lost its footing writes one short line per 30 second window and nothing in
 * between, however much is said.
 */
function isWindowed(segments: readonly Speech[]): boolean {
  if (median(segments.map((s) => s.endMs - s.startMs)) >= SHORT_MS) return false;
  const gaps = segments.slice(1).map((s, i) => s.startMs - (segments[i]?.startMs ?? 0));
  const regular = gaps.filter((gap) => Math.abs(gap - WINDOW_MS) <= WINDOW_TOLERANCE_MS);
  return regular.length >= gaps.length * WINDOW_SHARE;
}

/**
 * True when a transcript has the signature of speech made up by the model (a subtitle credit
 * repeated through the whole file) instead of what was said. Real conversations are neither this
 * repetitive nor this regular.
 */
export function looksInvented(segments: readonly Speech[], minSegments = MIN_SEGMENTS): boolean {
  if (segments.length < minSegments) return false;
  const ordered = segments.toSorted((a, b) => a.startMs - b.startMs);
  return isRepeated(ordered) || isWindowed(ordered);
}

const WINDOW_LENGTH_MS = 600_000;
const WINDOW_MIN_SEGMENTS = 3;
const MIN_TYPICAL_WORDS_PER_MINUTE = 40;
const SPARSE_SHARE = 0.25;

const wordCount = (segments: readonly Speech[]) =>
  segments.reduce((sum, { text }) => sum + text.split(/\s+/).filter(Boolean).length, 0);

/**
 * Windows of the recording whose transcript is not believable: made up in the structural ways
 * above, or far thinner than the rest of the recording (a quarter of the typical words per
 * minute), as when a cloud model invents a credit line for one stretch and transcribes the others.
 * Callers redo these stretches with another transcriber.
 */
export function suspectWindows(
  segments: readonly Speech[],
  durationMs: number,
): { startMs: number; endMs: number; invented: boolean }[] {
  const windows = Array.from({ length: Math.ceil(durationMs / WINDOW_LENGTH_MS) }, (_, i) => {
    const startMs = i * WINDOW_LENGTH_MS;
    const endMs = Math.min(startMs + WINDOW_LENGTH_MS, durationMs);
    const inside = segments.filter((s) => s.startMs >= startMs && s.startMs < endMs);
    const minutes = (endMs - startMs) / 60_000;
    return { startMs, endMs, inside, minutes, perMinute: wordCount(inside) / minutes };
  });
  const typical = median(windows.filter((w) => w.minutes >= 1).map((w) => w.perMinute));
  return windows.flatMap(({ startMs, endMs, inside, minutes, perMinute }) => {
    if (minutes < 1) return [];
    const invented = looksInvented(inside, WINDOW_MIN_SEGMENTS);
    const sparse = typical >= MIN_TYPICAL_WORDS_PER_MINUTE && perMinute < typical * SPARSE_SHARE;
    return invented || sparse ? [{ startMs, endMs, invented }] : [];
  });
}

const CREDIT_LINES = [
  /\b(ondertiteld|ondertitels?|vertaling|vertaald|untertitel\w*|subtitles?|sous-titr\w*|subtitulos?|amara)\b/,
  /\b(www|https?)\b|\.(com|nl|de|org)\b/,
  /^(tv|radio|omroep)\s+\p{L}+(\s+\p{L}+)?\s+(19|20)\d{2}$/u,
  /^\p{L}+(\s+\p{L}+)?\s+(19|20)\d{2}$/u,
];
const ISOLATION_MS = 8000;
const REPEATS = 3;
const SHORT_WORDS = 5;

const wordsOf = (text: string) => plain(text).split(' ').filter(Boolean);

/**
 * Lines a model writes over silence or noise: caption and station credits ("Ondertiteld door",
 * "TV Gelderland 2021"), and any short line that comes back at least three times, alone in the
 * recording each time, with no speech next to it.
 */
export function dropMadeUpLines<T extends Speech>(segments: readonly T[]): T[] {
  const ordered = segments.toSorted((a, b) => a.startMs - b.startMs);
  const isolated = (i: number) => {
    const before = ordered[i - 1];
    const after = ordered[i + 1];
    const segment = ordered[i];
    return (
      segment !== undefined &&
      (!before || segment.startMs - before.endMs >= ISOLATION_MS) &&
      (!after || after.startMs - segment.endMs >= ISOLATION_MS)
    );
  };
  const aloneCount = new Map<string, number>();
  ordered.forEach((segment, i) => {
    const line = plain(segment.text);
    if (wordsOf(segment.text).length <= SHORT_WORDS && isolated(i)) {
      aloneCount.set(line, (aloneCount.get(line) ?? 0) + 1);
    }
  });
  return ordered.filter((segment, i) => {
    const line = plain(segment.text);
    const written = segment.text
      .toLowerCase()
      .trim()
      .replace(/[.!?]+$/, '');
    const credit = CREDIT_LINES.some((pattern) => pattern.test(written));
    const repeated =
      wordsOf(segment.text).length <= SHORT_WORDS &&
      isolated(i) &&
      (aloneCount.get(line) ?? 0) >= REPEATS;
    return !credit && !repeated;
  });
}
