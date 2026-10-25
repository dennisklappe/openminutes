import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { looksInvented, suspectWindows } from '@openminutes/core';
import type { Segment, TranscriptionProvider } from '@openminutes/providers';
import type { TrimAudio } from './trim-audio.js';

const words = (segments: readonly Segment[]) =>
  segments.reduce((sum, { text }) => sum + text.split(/\s+/).filter(Boolean).length, 0);

const shift = (segment: Segment, offsetMs: number): Segment => ({
  ...segment,
  startMs: segment.startMs + offsetMs,
  endMs: segment.endMs + offsetMs,
  ...(segment.words && {
    words: segment.words.map((w) => ({
      ...w,
      startMs: w.startMs + offsetMs,
      endMs: w.endMs + offsetMs,
    })),
  }),
});

/**
 * A cloud model can make up one stretch of a long recording (a credit line every half minute)
 * and transcribe the rest. Each suspect window is cut out and redone by the fallback transcriber
 * and replaced when that is the better text. A window that stays made up is dropped.
 */
export async function repairWindows(
  segments: Segment[],
  durationMs: number,
  source: string,
  trim: TrimAudio,
  fallback: TranscriptionProvider | undefined,
  options: {
    language?: string;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<Segment[]> {
  let result = segments;
  const dir = await mkdtemp(join(tmpdir(), 'openminutes-window-'));
  try {
    const suspects = suspectWindows(segments, durationMs);
    for (const [index, window] of suspects.entries()) {
      options.onProgress?.(index, suspects.length);
      const inside = (s: Segment) => s.startMs >= window.startMs && s.startMs < window.endMs;
      let better: Segment[] | undefined;
      try {
        const clip = join(dir, `${String(window.startMs)}.opus`);
        await trim(source, clip, window);
        const redone = await fallback?.transcribe(
          { path: clip },
          {
            ...(options.language && { language: options.language }),
            ...(options.signal && { signal: options.signal }),
          },
        );
        if (redone && !looksInvented(redone, 3) && words(redone) > words(result.filter(inside))) {
          better = redone.map((s) => shift(s, window.startMs));
        }
      } catch (error) {
        console.error(`window at ${String(window.startMs)} ms could not be redone`, error);
      }
      if (better) result = [...result.filter((s) => !inside(s)), ...better];
      else if (window.invented) result = result.filter((s) => !inside(s));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return result.toSorted((a, b) => a.startMs - b.startMs);
}
