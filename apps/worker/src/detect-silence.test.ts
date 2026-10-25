import { describe, expect, it } from 'vitest';
import { parseSilences } from './detect-silence.js';

describe('parseSilences', () => {
  it('reads the ranges from the ffmpeg log', () => {
    const log = [
      '[silencedetect @ 0x1] silence_start: -0.000895833',
      '[silencedetect @ 0x1] silence_end: 91.21775 | silence_duration: 91.2186',
      '[silencedetect @ 0x1] silence_start: 176.334417',
    ].join('\n');
    expect(parseSilences(log, 330_428)).toEqual([
      { startMs: 0, endMs: 91_218 },
      { startMs: 176_334, endMs: 330_428 },
    ]);
  });

  it('finds nothing in a log without silence', () => {
    expect(parseSilences('size=N/A time=00:05:30', 330_000)).toEqual([]);
  });
});
