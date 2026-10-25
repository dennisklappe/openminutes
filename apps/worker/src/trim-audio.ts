import { rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SpeechRange } from '@openminutes/core';
import { runFfmpeg } from './ffmpeg.js';

export type TrimAudio = (input: string, output: string, range: SpeechRange) => Promise<void>;

export const trimAudio: TrimAudio = async (input, output, range) => {
  const partial = join(dirname(output), '.trimmed.opus.part');
  try {
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-ss',
      String(range.startMs / 1000),
      '-to',
      String(range.endMs / 1000),
      '-c',
      'copy',
      '-f',
      'opus',
      partial,
    ]);
    await rename(partial, output);
  } finally {
    await rm(partial, { force: true });
  }
};
