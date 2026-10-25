import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cameraConversionArgs, convertCameraImage } from './camera.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('cameraConversionArgs', () => {
  it('fits the image into a 16:9 frame and writes yuv4mpeg', () => {
    const args = cameraConversionArgs('/in/tile.png', '/out/camera.y4m');
    expect(args).toContain('/in/tile.png');
    expect(args.at(-1)).toBe('/out/camera.y4m');
    expect(args.join(' ')).toContain('pad=1280:720');
    expect(args.join(' ')).toContain('yuv4mpegpipe');
  });
});

describe.skipIf(!hasFfmpeg)('convertCameraImage', () => {
  let directory: string;
  let sample: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openminutes-camera-test-'));
    sample = join(directory, 'sample.png');
    spawnSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=320x200',
      '-frames:v',
      '1',
      sample,
    ]);
  });
  afterAll(() => rm(directory, { recursive: true, force: true }));

  it('turns an image into a short y4m loop', async () => {
    const output = await convertCameraImage(sample, directory);
    const bytes = await readFile(output);
    expect(bytes.subarray(0, 9).toString()).toBe('YUV4MPEG2');
    expect(bytes.subarray(0, 80).toString()).toContain('W1280 H720');
  });

  it('rejects a file that is not an image', async () => {
    await expect(convertCameraImage('/nonexistent.png', directory)).rejects.toThrow(/ffmpeg/);
  });
});
