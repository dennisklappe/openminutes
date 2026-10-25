import { describe, expect, it } from 'vitest';
import { makeSegment } from './segment.fixture.js';
import { SPEAKER_COLORS, speakerSlots, talkTime } from './speakers.js';

describe('speakerSlots', () => {
  it('numbers speakers by first appearance and skips unattributed segments', () => {
    const slots = speakerSlots([
      { speaker: 'Bob' },
      { speaker: null },
      { speaker: 'Alice' },
      { speaker: 'Bob' },
    ]);
    expect([...slots]).toEqual([
      ['Bob', 0],
      ['Alice', 1],
    ]);
  });

  it('reuses colors once the palette runs out', () => {
    const names = Array.from({ length: SPEAKER_COLORS + 1 }, (_, i) => ({ speaker: `P${i}` }));
    expect(speakerSlots(names).get(`P${SPEAKER_COLORS}`)).toBe(0);
  });
});

describe('talkTime', () => {
  it('shares time by speaker and ignores unnamed segments', () => {
    const segment = (speaker: string | null, startMs: number, endMs: number) =>
      makeSegment({ id: String(startMs), speaker, startMs, endMs });
    const result = talkTime([
      segment('A', 0, 3000),
      segment(null, 3000, 5000),
      segment('B', 5000, 6000),
    ]);
    expect(result.map((r) => [r.name, r.slot, r.share])).toEqual([
      ['A', 0, 0.75],
      ['B', 1, 0.25],
    ]);
  });
});
