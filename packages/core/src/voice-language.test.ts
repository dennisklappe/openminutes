import { describe, expect, it } from 'vitest';
import { isKnownLanguage, normalizeLanguage, UNKNOWN_LANGUAGE } from './voice-language.js';
import { matchVoices } from './voices.js';

describe('language codes', () => {
  it('keeps two letter lower case codes and calls the rest unknown', () => {
    expect(normalizeLanguage('NL')).toBe('nl');
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('pt_BR')).toBe('pt');
    for (const none of [undefined, null, '', 'auto', '??']) {
      expect(normalizeLanguage(none)).toBe(UNKNOWN_LANGUAGE);
    }
    expect(isKnownLanguage('de')).toBe(true);
    expect(isKnownLanguage('und')).toBe(false);
  });
});

describe('matching a voice to a name by language', () => {
  const known = [
    { name: 'Dana', embedding: [1, 0], language: 'nl' },
    { name: 'Dana', embedding: [0, 1], language: 'en' },
    { name: 'Eli', embedding: [1, 0], language: 'en' },
  ];

  it('uses the vectors of the language of a name first', () => {
    expect(matchVoices([0, 1], known, 0.55, 'nl')).toEqual([]);
    const found = matchVoices([1, 0], known, 0.55, 'nl');
    expect(found[0]).toEqual({ name: 'Dana', score: 1 });
  });

  it('falls back to other languages with a penalty for a name without one', () => {
    const nl = matchVoices([1, 0], known.slice(2), 0.55, 'nl');
    expect(nl[0]?.name).toBe('Eli');
    expect(nl[0]?.score).toBeLessThan(1);
  });

  it('ignores language when none is given', () => {
    expect(matchVoices([0, 1], known).map((m) => m.name)).toEqual(['Dana']);
  });
});
