import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trimAudio } from './trim-audio.js';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

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
    ])
      .toString()
      .trim(),
  );

describe.skipIf(!hasFfmpeg)('trimAudio', () => {
  it('cuts the requested range without re-encoding', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openminutes-trim-'));
    const input = join(dir, 'in.opus');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=60',
      '-c:a',
      'libopus',
      '-f',
      'opus',
      input,
    ]);
    const output = join(dir, 'out.opus');

    await trimAudio(input, output, { startMs: 12_000, endMs: 47_000 });

    expect(seconds(output)).toBeCloseTo(35, 1);
  });
});
