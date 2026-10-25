import { describe, expect, it } from 'vitest';
import { pickLanguage } from './local-whisper.js';

const heard = (language: string, confidence: number) => ({ language, confidence });

describe('pickLanguage', () => {
  it('lets the vote decide without a setting', () => {
    expect(pickLanguage('', heard('en', 0.9))).toBe('en');
    expect(pickLanguage('auto', heard('en', 0.6))).toBe('en');
    expect(pickLanguage('', undefined)).toBeUndefined();
  });

  it('keeps a language fixed in the settings when the vote agrees or is unsure', () => {
    expect(pickLanguage('nl', heard('nl', 1))).toBe('nl');
    expect(pickLanguage('nl', heard('en', 0.7))).toBe('nl');
    expect(pickLanguage('nl', undefined)).toBe('nl');
  });

  it('overrides a fixed language when the recording is clearly in another', () => {
    expect(pickLanguage('nl', heard('en', 0.8))).toBe('en');
    expect(pickLanguage('nl', heard('en', 1))).toBe('en');
  });
});
