export interface SpokenSegment {
  startMs: number;
  endMs: number;
  words?: { startMs: number; endMs: number }[];
}

export interface SpeechRange {
  startMs: number;
  endMs: number;
}

const TRIM_PADDING_MS = 2000;
const MIN_TRIM_MS = 1000;

export function detectSpeechRange(
  segments: SpokenSegment[],
  durationMs: number,
): SpeechRange | null {
  const spans = segments.flatMap((segment) =>
    segment.words && segment.words.length > 0 ? segment.words : [segment],
  );
  if (spans.length === 0 || durationMs <= 0) return null;

  const first = Math.min(...spans.map((span) => span.startMs));
  const last = Math.max(...spans.map((span) => span.endMs));
  const wantedStart = Math.max(0, first - TRIM_PADDING_MS);
  const wantedEnd = Math.min(durationMs, last + TRIM_PADDING_MS);
  const startMs = wantedStart >= MIN_TRIM_MS ? wantedStart : 0;
  const endMs = durationMs - wantedEnd >= MIN_TRIM_MS ? wantedEnd : durationMs;
  if (endMs <= startMs || (startMs === 0 && endMs === durationMs)) return null;
  return { startMs: Math.round(startMs), endMs: Math.round(endMs) };
}

export const shiftToRange = (timeMs: number, range: SpeechRange): number =>
  Math.min(Math.max(timeMs - range.startMs, 0), range.endMs - range.startMs);
