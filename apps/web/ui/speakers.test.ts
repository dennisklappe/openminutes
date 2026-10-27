import { describe, expect, it } from 'vitest';
import { makeSegment } from './segment.fixture.js';
import type { SegmentDto } from '../src/dto.js';
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

describe('speakerSlots for a shared tile', () => {
  it('keeps the voices of one tile on different colours even after the palette wrapped', () => {
    const filler = Array.from({ length: SPEAKER_COLORS - 1 }, (_, i) => ({ speaker: `P${i}` }));
    // Voice 1 lands on the last slot, Voice 2 would wrap to slot 0, which Voice 1 does not use.
    const slots = speakerSlots([
      ...filler,
      { speaker: 'Voice 1 (Jo and Sam)', viaSpeaker: 'Jo and Sam' },
      { speaker: 'Voice 2 (Jo and Sam)', viaSpeaker: 'Jo and Sam' },
    ]);
    expect(slots.get('Voice 1 (Jo and Sam)')).toBe(SPEAKER_COLORS - 1);
    expect(slots.get('Voice 2 (Jo and Sam)')).not.toBe(slots.get('Voice 1 (Jo and Sam)'));
  });

  it('moves a sibling off a slot the tile already uses', () => {
    const slots = speakerSlots([
      { speaker: 'A', viaSpeaker: 'Room' },
      ...Array.from({ length: SPEAKER_COLORS - 1 }, (_, i) => ({ speaker: `P${i}` })),
      // Plain slot would be 0 again, the same as A.
      { speaker: 'B', viaSpeaker: 'Room' },
    ]);
    expect(slots.get('A')).toBe(0);
    expect(slots.get('B')).toBe(1);
  });
});

describe('talkTime with a shared tile', () => {
  const line = (id: string, speaker: string | null, ms: number, extra: Partial<SegmentDto> = {}) =>
    makeSegment({ id, speaker, startMs: 0, endMs: ms, speakerId: speaker, ...extra });
  const via = { viaSpeaker: 'Ann and Sam' };

  it('lists each voice once and the tile as one muted row with only its own lines', () => {
    const rows = talkTime([
      line('1', 'Dennis', 40_000),
      line('2', 'Bart', 34_000, via),
      line('3', 'Pieter', 4_000, via),
      line('4', 'Ann and Sam', 22_000),
    ]);
    expect(rows.map((r) => [r.name, r.percent, r.unassigned])).toEqual([
      ['Dennis', 40, false],
      ['Bart', 34, false],
      ['Pieter', 4, false],
      ['Unassigned (Ann and Sam)', 22, true],
    ]);
    expect(rows.at(-1)?.slot).toBeNull();
    expect(rows.reduce((sum, r) => sum + r.percent, 0)).toBe(100);
  });

  it('hides a tile row under 2 percent and still adds up to 100', () => {
    const rows = talkTime([
      line('1', 'Dennis', 50_000),
      line('2', 'Bart', 49_000, via),
      line('3', 'Ann and Sam', 1_000),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Dennis', 'Bart']);
    expect(rows.reduce((sum, r) => sum + r.percent, 0)).toBe(100);
  });

  it('merges a seat and a voice of the same person, and only then', () => {
    const rows = talkTime([
      line('1', 'Dennis', 10_000, { speakerId: 'seat', speakerPersonId: 'p1' }),
      line('2', 'Dennis', 5_000, { speakerId: 'voice-seat', speakerPersonId: 'p1', ...via }),
      line('3', 'Dennis', 5_000, { speakerId: 'other', speakerPersonId: 'p2' }),
    ]);
    expect(rows.map((r) => [r.name, r.ms])).toEqual([
      ['Dennis', 15_000],
      ['Dennis', 5_000],
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it('leaves a tile without voices as a normal row', () => {
    const rows = talkTime([line('1', 'Dennis', 3_000), line('2', 'Room', 1_000)]);
    expect(rows.map((r) => [r.name, r.percent, r.unassigned])).toEqual([
      ['Dennis', 75, false],
      ['Room', 25, false],
    ]);
  });
});
