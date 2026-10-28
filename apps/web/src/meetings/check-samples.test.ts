import { describe, expect, it } from 'vitest';
import { pickSamples } from './check-samples.js';

const row = (
  id: string,
  startS: number,
  lengthS: number,
  extra: { text?: string; mixed?: 'marked' | 'probable' | null } = {},
) => ({
  id,
  startMs: startS * 1000,
  endMs: (startS + lengthS) * 1000,
  text: extra.text ?? 'We agreed on the dates for the next release.',
  mixed: extra.mixed ?? null,
});

describe('pickSamples', () => {
  it('takes the longest clean lines of 3 to 12 seconds, spread apart, in meeting order', () => {
    const picked = pickSamples([
      row('short', 0, 2),
      row('long', 5, 20),
      row('a', 10, 9),
      row('b', 12, 8),
      row('c', 100, 6),
      row('d', 200, 4),
    ]);
    expect(picked.map((s) => s.id)).toEqual(['a', 'c', 'd']);
  });

  it('skips lines where people talk over each other and filler', () => {
    const picked = pickSamples([
      row('over', 0, 10, { mixed: 'marked' }),
      row('maybe', 30, 10, { mixed: 'probable' }),
      row('filler', 60, 10, { text: 'Yeah, yeah, okay.' }),
      row('ok', 90, 5),
    ]);
    expect(picked.map((s) => s.id)).toEqual(['ok']);
  });

  it('fills up with close lines when the meeting is short', () => {
    const picked = pickSamples([row('a', 0, 5), row('b', 6, 6), row('c', 13, 4), row('d', 18, 3)]);
    expect(picked.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns id, times and trimmed text only, and nothing when no line is usable', () => {
    expect(pickSamples([row('a', 0, 4, { text: '  We will ship it on Friday.  ' })])).toEqual([
      { id: 'a', startMs: 0, endMs: 4000, text: 'We will ship it on Friday.' },
    ]);
    expect(pickSamples([row('a', 0, 1), row('b', 5, 30)])).toEqual([]);
  });
});
