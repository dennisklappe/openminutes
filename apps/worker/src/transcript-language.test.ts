import type { Segment } from '@openminutes/providers';
import { describe, expect, it } from 'vitest';
import { toTranscriptRows } from './transcript-store.js';

const segment = (text: string, extra: Partial<Segment> = {}): Segment => ({
  startMs: 0,
  endMs: 3000,
  text,
  ...extra,
});

describe('the language of a transcript line', () => {
  it('is the language of the meeting, as a two letter code', () => {
    const rows = toTranscriptRows('m', [segment('hallo')], [], null, 'indicator', 'NL');
    expect(rows[0]?.language).toBe('nl');
    expect(
      toTranscriptRows('m', [segment('hi')], [], null, 'indicator', 'en-US')[0]?.language,
    ).toBe('en');
  });

  it('is the language of the segment when a provider names one', () => {
    const rows = toTranscriptRows(
      'm',
      [segment('hallo', { language: 'nl' }), segment('hello', { language: 'en', startMs: 4000 })],
      [],
      null,
      'indicator',
      'nl',
    );
    expect(rows.map((r) => r.language)).toEqual(['nl', 'en']);
  });

  it('stays empty when no language is known', () => {
    expect(toTranscriptRows('m', [segment('hi')], [])[0]?.language).toBeNull();
    expect(
      toTranscriptRows('m', [segment('hi')], [], null, 'indicator', 'auto')[0]?.language,
    ).toBeNull();
  });
});
