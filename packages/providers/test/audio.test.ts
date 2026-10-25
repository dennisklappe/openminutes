import { describe, expect, it } from 'vitest';
import { uploadName } from '../src/audio.js';

describe('uploadName', () => {
  it('sends .opus files as .ogg, which OpenAI accepts', () => {
    expect(uploadName('/data/meetings/x/000.opus')).toBe('000.ogg');
  });

  it('keeps other names', () => {
    expect(uploadName('/data/a.WAV')).toBe('a.WAV');
  });
});
