import type { SilentRange } from '@openminutes/core';
import { runFfmpeg } from './ffmpeg.js';

const NOISE_FLOOR_DB = -45;
const MIN_SILENCE_SECONDS = 2;

export type DetectSilence = (input: string, durationMs: number) => Promise<SilentRange[]>;

export function parseSilences(log: string, durationMs: number): SilentRange[] {
  const ranges: SilentRange[] = [];
  let startMs: number | undefined;
  for (const line of log.split('\n')) {
    const start = /silence_start: (-?[\d.]+)/.exec(line);
    const end = /silence_end: (-?[\d.]+)/.exec(line);
    if (start?.[1]) startMs = Math.max(0, Math.round(Number(start[1]) * 1000));
    else if (end?.[1] && startMs !== undefined) {
      ranges.push({ startMs, endMs: Math.round(Number(end[1]) * 1000) });
      startMs = undefined;
    }
  }
  if (startMs !== undefined && startMs < durationMs) ranges.push({ startMs, endMs: durationMs });
  return ranges;
}

export const detectSilence: DetectSilence = async (input, durationMs) => {
  const { stderr } = await runFfmpeg([
    '-hide_banner',
    '-nostats',
    '-i',
    input,
    '-af',
    `silencedetect=noise=${NOISE_FLOOR_DB}dB:d=${MIN_SILENCE_SECONDS}`,
    '-f',
    'null',
    '-',
  ]);
  return parseSilences(stderr, durationMs);
};
