import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeAudio } from './merge-audio.js';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const tone = (path: string, seconds: number) =>
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-ac',
    '1',
    '-c:a',
    'libopus',
    '-f',
    'opus',
    path,
  ]);

const seconds = (path: string) =>
  Number.parseFloat(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      path,
    ]).toString(),
  );

describe.skipIf(!hasFfmpeg)('mergeAudio', () => {
  it('concatenates opus segments into one playable file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openminutes-merge-test-'));
    const inputs = ['a.opus', 'b.opus', 'c.opus'].map((name) => join(dir, name));
    inputs.forEach((path, index) => tone(path, index + 1));

    const output = join(dir, 'merged.opus');
    await mergeAudio(inputs, output);

    expect(seconds(output)).toBeCloseTo(6, 0);
    expect((await readFile(output)).subarray(0, 4).toString()).toBe('OggS');
  });

  it('converts fragmented AAC in mp4 (iOS Safari) to opus', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openminutes-merge-test-'));
    const input = join(dir, 'recording.m4a');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3',
      '-c:a',
      'aac',
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      '-f',
      'mp4',
      input,
    ]);

    const output = join(dir, 'merged.opus');
    await mergeAudio([input], output);

    expect(seconds(output)).toBeCloseTo(3, 0);
    expect((await readFile(output)).subarray(0, 4).toString()).toBe('OggS');
  });
});
