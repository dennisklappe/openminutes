import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSegmentLine, startRecording, type Segment } from './recorder.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('parseSegmentLine', () => {
  it('reads ffmpeg csv segment lists', () => {
    expect(parseSegmentLine('000.opus,0.000000,12.345000\n')).toEqual({
      fileName: '000.opus',
      durationMs: 12345,
    });
  });

  it('ignores malformed lines', () => {
    expect(parseSegmentLine('')).toBeUndefined();
    expect(parseSegmentLine('000.opus,x,y')).toBeUndefined();
  });
});

describe.skipIf(!hasFfmpeg)('startRecording', () => {
  it('writes Opus segments and reports them when stopped', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'openminutes-rec-'));
    const segments: Segment[] = [];
    const recording = startRecording({
      inputArgs: ['-re', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'],
      outputDir,
      segmentSeconds: 3600,
      onSegment: (segment) => {
        segments.push(segment);
        return Promise.resolve();
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await recording.stop();

    expect(await readdir(outputDir)).toEqual(['000.opus']);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.durationMs).toBeGreaterThan(1_000);
  });
});
