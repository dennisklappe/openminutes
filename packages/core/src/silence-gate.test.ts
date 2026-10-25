import { describe, expect, it } from 'vitest';
import { dropSilentSpeech } from './silence-gate.js';

const silences = [{ startMs: 10_000, endMs: 60_000 }];
const alice = { participantId: 'alice', startMs: 9000, endMs: 12_000 };

describe('dropSilentSpeech', () => {
  it('drops a known phrase in silence even when a speaker indicator is lit', () => {
    const items = [{ startMs: 30_000, endMs: 30_100, text: 'Thank you.' }];
    expect(
      dropSilentSpeech(items, silences, [{ ...alice, startMs: 29_000, endMs: 31_000 }]),
    ).toEqual([]);
  });

  it('drops other text in silence when nobody was speaking', () => {
    const items = [{ startMs: 30_000, endMs: 31_000, text: 'Iawn.' }];
    expect(dropSilentSpeech(items, silences, [alice])).toEqual([]);
  });

  it('keeps other text in silence while a speaker indicator is lit', () => {
    const items = [{ startMs: 30_000, endMs: 31_000, text: 'Mm-hm.' }];
    const spans = [{ ...alice, startMs: 29_000, endMs: 31_000 }];
    expect(dropSilentSpeech(items, silences, spans)).toEqual(items);
  });

  it('keeps a phrase outside silence', () => {
    const items = [{ startMs: 5000, endMs: 6000, text: 'Thank you.' }];
    expect(dropSilentSpeech(items, silences, [])).toEqual(items);
  });

  it('keeps speech that touches the edge of a silence', () => {
    const items = [{ startMs: 9000, endMs: 10_050, text: 'Bye now.' }];
    expect(dropSilentSpeech(items, silences, [])).toEqual(items);
  });

  it('shrinks an item to the words that were spoken', () => {
    const words = [
      { startMs: 8000, endMs: 8500, text: 'See' },
      { startMs: 8500, endMs: 9000, text: 'you.' },
      { startMs: 20_000, endMs: 20_300, text: 'Bye' },
    ];
    const items = [{ startMs: 8000, endMs: 20_300, text: 'See you. Bye', words }];
    expect(dropSilentSpeech(items, silences, [])).toEqual([
      { startMs: 8000, endMs: 9000, text: 'See you.', words: words.slice(0, 2) },
    ]);
  });

  it('drops an item whose words were all invented', () => {
    const words = [{ startMs: 30_000, endMs: 30_100, text: 'you' }];
    expect(
      dropSilentSpeech([{ startMs: 30_000, endMs: 30_100, text: 'you', words }], silences, []),
    ).toEqual([]);
  });

  it('changes nothing without silences', () => {
    const items = [{ startMs: 30_000, endMs: 30_100, text: 'Thank you.' }];
    expect(dropSilentSpeech(items, [], [])).toEqual(items);
  });

  it('drops a lone "you" far from any speaker indicator when the stretch is not silent', () => {
    // Recorded live on 2026-10-22: the join tone of Meet was transcribed as "you".
    const items = [{ startMs: 9700, endMs: 11_100, text: 'you' }];
    const far = [{ ...alice, startMs: 59_000, endMs: 65_000 }];
    expect(dropSilentSpeech(items, [], far)).toEqual([]);
  });

  it('keeps a lone "Thank you" while a speaker indicator is lit near it', () => {
    const items = [{ startMs: 9700, endMs: 11_100, text: 'Thank you.' }];
    const near = [{ ...alice, startMs: 10_000, endMs: 11_000 }];
    expect(dropSilentSpeech(items, [], near)).toEqual(items);
  });

  it('keeps a lone "you" when the call has no speaker indicator data', () => {
    const items = [{ startMs: 9700, endMs: 11_100, text: 'you' }];
    expect(dropSilentSpeech(items, [], [])).toEqual(items);
  });
});
