import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMedia, type Exec } from '../src/media.js';
import { tempAudio } from './helpers.js';

describe('media', () => {
  it('re-encodes even a small file, levelled, in windows of at most ten minutes', async () => {
    const path = await tempAudio('small.mp3', '12345');
    let args: string[] = [];
    const exec: Exec = async (command, ffmpegArgs) => {
      if (command === 'ffmpeg') {
        args = ffmpegArgs;
        await writeFile(join(dirname(ffmpegArgs.at(-1) ?? ''), 'chunk00000.mp3'), 'a');
        return '';
      }
      return '61.5\n';
    };
    const { chunks } = await createMedia(exec).prepare(path, 100 * 1024 * 1024);

    expect(chunks.map((c) => [c.offsetMs, c.durationMs])).toEqual([[0, 61_500]]);
    expect(args[args.indexOf('-segment_time') + 1]).toBe('600');
    expect(args).toContain(
      'aformat=sample_rates=16000:channel_layouts=mono,highpass=f=80,dynaudnorm=f=200:g=11,alimiter=limit=0.8:level=false',
    );
  });

  it('splits large files and accumulates offsets from the real chunk durations', async () => {
    const path = await tempAudio('big.mp3', 'x'.repeat(1000));
    const durations = new Map([
      ['chunk00000.mp3', '120.5'],
      ['chunk00001.mp3', '119.75'],
      ['chunk00002.mp3', '59.75'],
    ]);
    let splitArgs: string[] = [];
    const exec: Exec = async (command, args) => {
      if (command === 'ffmpeg') {
        splitArgs = args;
        const pattern = args.at(-1) ?? '';
        for (const name of ['chunk00002.mp3', 'chunk00000.mp3', 'chunk00001.mp3', 'notes.txt']) {
          await mkdir(dirname(pattern), { recursive: true });
          await writeFile(join(dirname(pattern), name), 'a');
        }
        return '';
      }
      const target = args.at(-1) ?? '';
      return durations.get(target) ?? durations.get(target.split('/').at(-1) ?? '') ?? 'NaN';
    };
    const media = createMedia(exec);
    const { chunks, cleanup } = await media.prepare(path, 500);

    expect(chunks.map((c) => [c.path.split('/').at(-1), c.offsetMs, c.durationMs])).toEqual([
      ['chunk00000.mp3', 0, 120_500],
      ['chunk00001.mp3', 120_500, 119_750],
      ['chunk00002.mp3', 240_250, 59_750],
    ]);
    expect(splitArgs).toContain('-segment_time');
    expect(splitArgs[splitArgs.indexOf('-segment_time') + 1]).toBe(
      String(Math.floor((500 * 0.8 * 8) / 48_000)),
    );
    await cleanup();
  });

  it('wraps tool failures in a ProviderError', async () => {
    const exec: Exec = () => Promise.reject(new Error('spawn ffmpeg ENOENT'));
    await expect(createMedia(exec).prepare(await tempAudio(), 100)).rejects.toMatchObject({
      code: 'media',
      message: 'media: ffmpeg failed',
    });
  });

  it('rejects unreadable durations', async () => {
    const exec: Exec = async (command, args) => {
      if (command === 'ffmpeg')
        await writeFile(join(dirname(args.at(-1) ?? ''), 'chunk00000.mp3'), 'a');
      return 'N/A';
    };
    await expect(createMedia(exec).prepare(await tempAudio(), 100)).rejects.toMatchObject({
      code: 'media',
    });
  });
});

const tool = (command: string, args: string[]) => spawnSync(command, args, { encoding: 'utf8' });
const hasFfmpeg = tool('ffmpeg', ['-version']).status === 0;

describe.skipIf(!hasFfmpeg)('media with real audio', () => {
  // Safari writes webm without a duration, and phone microphones with automatic gain clip. A tone
  // 20 dB over full scale, written to a pipe, has both.
  async function clippedStreamedWebm(seconds: number): Promise<string> {
    const path = join(await mkdtemp(join(tmpdir(), 'openminutes-media-test-')), 'recording.webm');
    const encoded = spawnSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=300:duration=${String(seconds)}`,
        '-af',
        'volume=20dB',
        '-ac',
        '2',
        '-c:a',
        'libopus',
        '-f',
        'webm',
        'pipe:1',
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    await writeFile(path, encoded.stdout);
    return path;
  }

  it('cuts a webm that has no duration into windows with the real length', async () => {
    const path = await clippedStreamedWebm(95);
    const probe = tool('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      path,
    ]);
    expect(probe.stdout.trim()).toBe('N/A');

    const { chunks, cleanup } = await createMedia().prepare(path, 24 * 1024 * 1024);
    try {
      const total = chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0);
      expect(total / 1000).toBeCloseTo(95, 0);
      expect(chunks.map((chunk) => chunk.offsetMs)).toEqual(
        chunks.map((_, i) => chunks.slice(0, i).reduce((sum, c) => sum + c.durationMs, 0)),
      );
    } finally {
      await cleanup();
    }
  });

  it('levels clipped audio so the peaks stay below full scale', async () => {
    const { chunks, cleanup } = await createMedia().prepare(
      await clippedStreamedWebm(5),
      24 * 1024 * 1024,
    );
    try {
      const stats = tool('ffmpeg', [
        '-hide_banner',
        '-i',
        chunks[0]?.path ?? '',
        '-af',
        'astats',
        '-f',
        'null',
        '-',
      ]);
      const peak = /Peak level dB: (-?[\d.]+)/.exec(stats.stderr);
      expect(Number(peak?.[1])).toBeLessThan(-0.05);
    } finally {
      await cleanup();
    }
  });
});
