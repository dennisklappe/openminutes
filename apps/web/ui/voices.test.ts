import { describe, expect, it } from 'vitest';
import type { VoiceDto } from '../src/dto.js';
import { canSave, initialName } from './voices.js';

const voice = (name: string, confirmed = false): VoiceDto => ({
  id: 'v1',
  name,
  confirmed,
  durationMs: 1000,
  snippets: [],
  suggestions: [],
});

describe('initialName', () => {
  it('leaves the input empty for automatic labels', () => {
    expect(initialName(voice('Speaker 2'))).toBe('');
    expect(initialName(voice('Speaker 2', true))).toBe('Speaker 2');
    expect(initialName(voice('Anna'))).toBe('Anna');
  });
});

describe('canSave', () => {
  it('needs a name of 1 to 80 characters', () => {
    expect(canSave(voice('Speaker 1'), '  ', false)).toBe(false);
    expect(canSave(voice('Speaker 1'), 'x'.repeat(81), false)).toBe(false);
    expect(canSave(voice('Speaker 1'), ' Anna ', false)).toBe(true);
  });

  it('does not save an unchanged confirmed name unless the voice should be remembered', () => {
    expect(canSave(voice('Anna', true), 'Anna', false)).toBe(false);
    expect(canSave(voice('Anna', true), 'Anna', true)).toBe(true);
    expect(canSave(voice('Anna', true), 'Anne', false)).toBe(true);
  });
});
