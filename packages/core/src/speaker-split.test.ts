import { describe, expect, it } from 'vitest';
import { estimateWords, splitAtChanges } from './speaker-split.js';
import { assignSpeakers, type SpeakerSpan } from './speakers.js';

const span = (participantId: string, startMs: number, endMs: number): SpeakerSpan => ({
  participantId,
  startMs,
  endMs,
});

const LINE = {
  startMs: 0,
  endMs: 6000,
  text: 'What for exactly then we start with the plan for next week',
};

describe('estimateWords', () => {
  it('spreads the words over the line by characters, in order and without gaps', () => {
    const words = estimateWords('aa bbbb c', 0, 1000);
    expect(words.map((w) => w.text)).toEqual(['aa', 'bbbb', 'c']);
    expect(words[0]?.startMs).toBe(0);
    expect(words.at(-1)?.endMs).toBe(1000);
    expect(words[1]?.endMs ?? 0).toBeGreaterThan(words[0]?.endMs ?? 0);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]?.startMs).toBe(words[i - 1]?.endMs);
    }
  });
});

describe('splitAtChanges', () => {
  it('cuts a line where the indicator hands over from one speaker to another', () => {
    const parts = splitAtChanges(LINE, [span('a', 0, 1500), span('b', 1500, 6000)]);
    expect(parts?.map((p) => p.participantId)).toEqual(['a', 'b']);
    expect(parts?.map((p) => p.text).join(' ')).toBe(LINE.text);
    expect(parts?.[0]?.text.split(' ').length).toBeGreaterThanOrEqual(2);
    expect(parts?.[0]?.endMs).toBeLessThanOrEqual(parts?.[1]?.startMs ?? 0);
  });

  it('places the cut before the indicator of the second speaker lit up, not after', () => {
    const late = splitAtChanges(LINE, [span('a', 0, 1500), span('b', 2400, 6000)]);
    const exact = splitAtChanges(LINE, [span('a', 0, 1500), span('b', 1500, 6000)]);
    expect(late?.[0]?.text.length ?? 0).toBeGreaterThanOrEqual(exact?.[0]?.text.length ?? 0);
    expect(late?.[0]?.endMs ?? 0).toBeLessThanOrEqual(2400);
  });

  it('keeps a line whole when one speaker has it all', () => {
    expect(splitAtChanges(LINE, [span('a', 0, 6000)])).toBeUndefined();
  });

  it('does not split on overlap alone', () => {
    expect(splitAtChanges(LINE, [span('a', 0, 6000), span('b', 1000, 5000)])).toBeUndefined();
  });

  it('does not split on a flicker shorter than the minimum part', () => {
    expect(
      splitAtChanges(LINE, [span('a', 0, 2000), span('b', 2000, 2300), span('a', 2300, 6000)]),
    ).toBeUndefined();
  });

  it('does not split off a part with fewer than two words', () => {
    const short = { startMs: 0, endMs: 6000, text: 'Why not a long answer comes here now' };
    // The first speaker holds 700 ms, about one word of the estimate.
    const parts = splitAtChanges(short, [span('a', 0, 700), span('b', 700, 6000)]);
    expect(parts).toBeUndefined();
  });

  it('keeps every word when a short part is folded into its neighbour', () => {
    const parts = splitAtChanges(LINE, [
      span('a', 0, 2500),
      span('b', 2500, 3200),
      span('c', 3200, 6000),
    ]);
    expect(parts?.map((p) => p.text).join(' ')).toBe(LINE.text);
  });

  it('leaves a line of three words alone', () => {
    expect(
      splitAtChanges({ startMs: 0, endMs: 3000, text: 'one two three' }, [
        span('a', 0, 1500),
        span('b', 1500, 3000),
      ]),
    ).toBeUndefined();
  });
});

describe('assignSpeakers on lines without word times', () => {
  it('returns one line per speaker for a line that spans a handover', () => {
    const result = assignSpeakers([{ ...LINE }], [span('a', 0, 1500), span('b', 1500, 6000)]);
    expect(result.map((r) => r.participantId)).toEqual(['a', 'b']);
  });

  it('keeps a line with word times in the word pipeline', () => {
    const words = LINE.text.split(' ').map((text, i) => ({
      text,
      startMs: i * 500,
      endMs: i * 500 + 450,
    }));
    const result = assignSpeakers(
      [{ ...LINE, words }],
      [span('a', 0, 1500), span('b', 1500, 6000)],
    );
    expect(result.map((r) => r.participantId)).toEqual(['a', 'b']);
  });
});
