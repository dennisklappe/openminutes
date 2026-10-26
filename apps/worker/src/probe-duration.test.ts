import { describe, expect, it } from 'vitest';
import { parseDuration } from './probe-duration.js';

describe('parseDuration', () => {
  it('reads the length from the ffmpeg log in milliseconds', () => {
    const log =
      'Input #0, mp3, from a.mp3:\n  Duration: 01:02:03.45, start: 0.025, bitrate: 128 kb/s';
    expect(parseDuration(log)).toBe(3_723_450);
  });

  it('has no answer when the log has no length', () => {
    expect(parseDuration('Duration: N/A')).toBeUndefined();
  });
});
