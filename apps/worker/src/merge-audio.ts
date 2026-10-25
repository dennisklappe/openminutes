import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { runFfmpeg } from './ffmpeg.js';

export type MergeAudio = (inputs: string[], output: string) => Promise<void>;

const OPUS_EXTENSIONS = new Set(['.opus', '.webm', '.ogg']);

// Opus in webm or ogg is copied as is. Anything else (AAC in mp4 from iOS Safari, mp3) cannot be
// written into an opus file without converting it, so it is encoded to Opus.
const codecArgs = (inputs: string[]) =>
  inputs.every((path) => OPUS_EXTENSIONS.has(extname(path).toLowerCase()))
    ? ['-c', 'copy']
    : ['-c:a', 'libopus', '-b:a', '48k', '-ac', '1'];

const quote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;

export const mergeAudio: MergeAudio = async (inputs, output) => {
  const dir = await mkdtemp(join(tmpdir(), 'openminutes-merge-'));
  const partial = join(dirname(output), '.merged.opus.part');
  try {
    const list = join(dir, 'list.txt');
    await writeFile(list, inputs.map((path) => `file ${quote(path)}\n`).join(''));
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      ...codecArgs(inputs),
      '-f',
      'opus',
      partial,
    ]);
    await rename(partial, output);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(partial, { force: true });
  }
};
