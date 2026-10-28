import { describe, expect, it } from 'vitest';
import { makeSegment } from './segment.fixture.js';
import type { SegmentDto } from '../src/dto.js';
import {
  countSpeakers,
  SPEAKER_COLORS,
  speakerCountLabel,
  speakerResultLine,
  speakerSlots,
  talkTime,
} from './speakers.js';

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

describe('talkTime order', () => {
  it('lists the most talkative first while keeping each colour slot', () => {
    const segment = (speaker: string, startMs: number, endMs: number) =>
      makeSegment({ id: String(startMs), speaker, startMs, endMs });
    const result = talkTime([
      segment('A', 0, 1000),
      segment('B', 1000, 4000),
      segment('C', 4000, 6000),
    ]);
    expect(result.map((r) => [r.name, r.slot])).toEqual([
      ['B', 1],
      ['C', 2],
      ['A', 0],
    ]);
    expect(result.map((r) => r.share)).toEqual(
      [...result.map((r) => r.share)].sort((a, b) => b - a),
    );
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
      ['Unassigned (Ann and Sam)', 22, true],
      ['Pieter', 4, false],
    ]);
    expect(rows.find((r) => r.unassigned)?.slot).toBeNull();
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

describe('countSpeakers', () => {
  const line = (id: string, speaker: string | null, viaSpeaker: string | null = null) =>
    makeSegment({
      id,
      speaker,
      viaSpeaker,
      startMs: Number(id) * 1000,
      endMs: Number(id) * 1000 + 900,
    });

  it('counts each person with lines once and skips unattributed lines', () => {
    expect(
      countSpeakers([line('0', 'Ann'), line('1', 'Bob'), line('2', 'Ann'), line('3', null)]),
    ).toBe(2);
    expect(countSpeakers([])).toBe(0);
  });

  it('counts the voices of a shared tile, not the tile', () => {
    const segments = [line('0', 'Voice 1', 'Room'), line('1', 'Voice 2', 'Room'), line('2', 'Ann')];
    expect(countSpeakers(segments)).toBe(3);
  });
});

describe('speakerCountLabel', () => {
  it('words the count for recordings and calls', () => {
    expect(speakerCountLabel(9, null, 'speakers')).toBe('9 speakers');
    expect(speakerCountLabel(1, null, 'speakers')).toBe('1 speaker');
    expect(speakerCountLabel(1, null, 'people')).toBe('1 person');
    expect(speakerCountLabel(4, null, 'people')).toBe('4 people');
  });

  it('adds the requested number when it was fixed', () => {
    expect(speakerCountLabel(9, 2, 'speakers')).toBe('9 speakers, requested 2');
  });
});

describe('speakerResultLine', () => {
  it('says what the re-run found and what it was', () => {
    expect(speakerResultLine(2, 9)).toBe('Found 2 speakers (was 9)');
    expect(speakerResultLine(1, 3)).toBe('Found 1 speaker (was 3)');
    expect(speakerResultLine(3, 3)).toBe('Found 3 speakers (was 3)');
  });
});

describe('talkTime participant', () => {
  it('keeps the participant to edit per row and none for unassigned time', () => {
    const line = (speaker: string, speakerId: string | null, startMs: number, endMs: number) =>
      makeSegment({ id: String(startMs), speaker, speakerId, startMs, endMs });
    const result = talkTime([line('Tnf', 'p1', 0, 3000), line('Dennis', 'p2', 3000, 4000)]);
    expect(result.map((r) => [r.name, r.participantId])).toEqual([
      ['Tnf', 'p1'],
      ['Dennis', 'p2'],
    ]);
  });
});
