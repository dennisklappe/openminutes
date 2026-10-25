import { languageField } from '@openminutes/providers';
import { describe, expect, it } from 'vitest';
import { filterLanguages, languageName, languages } from './languages.js';

describe('languages', () => {
  it('are the languages of the transcription settings', () => {
    const options = (languageField.meta()?.['options'] ?? []) as { value: string }[];
    expect(languages.map(([code]) => code)).toEqual(
      options.map(({ value }) => value).filter((value) => value !== ''),
    );
  });

  it('names a code and falls back to the code', () => {
    expect(languageName('nl')).toBe('Dutch');
    expect(languageName('xx')).toBe('xx');
  });

  it('filters by name or code, ignoring case', () => {
    expect(filterLanguages('')).toHaveLength(languages.length);
    expect(filterLanguages('  du ')).toEqual([['nl', 'Dutch']]);
    expect(filterLanguages('DE')).toEqual([['de', 'German']]);
    expect(filterLanguages('zzz')).toEqual([]);
  });
});
