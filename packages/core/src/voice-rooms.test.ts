import { describe, expect, it } from 'vitest';
import {
  assignToRoomVoice,
  findRoomVoices,
  findRoomVoicesFixed,
  matchVoiceNumbers,
  ROOM_MIN_CLUSTER_LINES,
  ROOM_OTHER_TILE_SIMILARITY,
  type RoomLine,
} from './voice-rooms.js';

// Two voices as directions in a small space, with a little noise per line.
const lines = (direction: number[], from: number, count: number, ms = 5000): RoomLine[] =>
  Array.from({ length: count }, (_, i) => ({
    key: from + i,
    embedding: direction.map(
      (value, k) => value + (k === (i % 3) + 2 ? 0.05 * (i % 2 ? 1 : -1) : 0),
    ),
    durationMs: ms,
  }));
const ANNA = [1, 0, 0, 0, 0];
const BRAM = [0, 1, 0, 0, 0];

describe('findRoomVoices', () => {
  it('finds two voices in one tile and orders them by speech', () => {
    const found = findRoomVoices([...lines(ANNA, 0, 4), ...lines(BRAM, 10, 6)]);
    expect(found).toHaveLength(2);
    expect(found[0]?.keys.toSorted((a, b) => a - b)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(found[1]?.durationMs).toBe(20_000);
  });

  it('does not flag a tile with one voice', () => {
    expect(findRoomVoices(lines(ANNA, 0, 12))).toEqual([]);
  });

  it('ignores a small group of odd lines, such as an indicator that lagged', () => {
    const odd = lines(BRAM, 20, ROOM_MIN_CLUSTER_LINES - 1);
    expect(findRoomVoices([...lines(ANNA, 0, 10), ...odd])).toEqual([]);
    // Enough lines but too little speech.
    expect(findRoomVoices([...lines(ANNA, 0, 10), ...lines(BRAM, 20, 3, 3000)])).toEqual([]);
  });

  it('does not take another participant leaking into the tile for a second person', () => {
    const other = [0, 1, 0, 0, 0];
    expect(findRoomVoices([...lines(ANNA, 0, 4), ...lines(BRAM, 10, 4)], [other])).toEqual([]);
    expect(
      findRoomVoices([...lines(ANNA, 0, 4), ...lines(BRAM, 10, 4)], [[0, 0, 0, 0, 1]]),
    ).toHaveLength(2);
    expect(ROOM_OTHER_TILE_SIMILARITY).toBeGreaterThan(0.5);
  });

  it('needs enough lines to look at all', () => {
    expect(findRoomVoices([...lines(ANNA, 0, 2), ...lines(BRAM, 10, 2)])).toEqual([]);
  });
});

describe('assignToRoomVoice', () => {
  const centroids = [ANNA, BRAM];

  it('gives a line to the nearest voice when it clearly leads', () => {
    expect(assignToRoomVoice([0.95, 0.1, 0, 0, 0], 4000, centroids)).toBe(0);
    expect(assignToRoomVoice([0.1, 0.9, 0, 0, 0], 4000, centroids)).toBe(1);
  });

  it('leaves a short line, a line between the voices and a line like neither unassigned', () => {
    expect(assignToRoomVoice(ANNA, 800, centroids)).toBeUndefined();
    expect(assignToRoomVoice([0.7, 0.68, 0, 0, 0], 4000, centroids)).toBeUndefined();
    expect(assignToRoomVoice([0, 0, 1, 0, 0], 4000, centroids)).toBeUndefined();
  });
});

describe('findRoomVoicesFixed', () => {
  const CARL = [0, 0, 1, 0, 0];

  it('splits into exactly the asked number of voices, even when the voices sound alike', () => {
    const close = [1, 0.4, 0, 0, 0];
    const mixed = [...lines(ANNA, 0, 4, 3000), ...lines(close, 10, 4, 3000)];
    // Without a count they join (similarity above the bar), with k = 2 they are split.
    expect(findRoomVoices(mixed)).toEqual([]);
    const found = findRoomVoicesFixed(mixed, 2);
    expect(found).toHaveLength(2);
    expect(found.flatMap((v) => v.keys).toSorted((a, b) => a - b)).toHaveLength(8);
  });

  it('splits a lopsided tile of close voices when the count is known', () => {
    // The real case: one voice speaks four times as much, and the two sit well below the auto bar.
    const close = [0.8, 0.6, 0, 0, 0];
    const mixed = [...lines(ANNA, 0, 12, 4000), ...lines(close, 20, 3, 4000)];
    expect(findRoomVoices(mixed)).toEqual([]);
    const found = findRoomVoicesFixed(mixed, 2);
    expect(found.map((v) => v.keys.length)).toEqual([12, 3]);
    expect(found.map((v) => v.durationMs)).toEqual([48_000, 12_000]);
  });

  it('finds three voices when told so and orders them by speech', () => {
    const found = findRoomVoicesFixed(
      [...lines(ANNA, 0, 3), ...lines(BRAM, 10, 5), ...lines(CARL, 20, 4)],
      3,
    );
    expect(found.map((v) => v.keys.length)).toEqual([5, 4, 3]);
  });

  it('gives nothing for a count under two or over the maximum, or too few lines', () => {
    const all = [...lines(ANNA, 0, 4), ...lines(BRAM, 10, 4)];
    expect(findRoomVoicesFixed(all, 1)).toEqual([]);
    expect(findRoomVoicesFixed(all, 5)).toEqual([]);
    expect(findRoomVoicesFixed(all.slice(0, 3), 2)).toEqual([]);
  });

  it('refuses a split that leaves a voice with a single line', () => {
    expect(findRoomVoicesFixed([...lines(ANNA, 0, 6), ...lines(BRAM, 10, 1)], 2)).toEqual([]);
  });
});

describe('matchVoiceNumbers', () => {
  it('gives a voice the number of the known voice it sounds like, whatever the order', () => {
    const known = [
      { number: 1, centroid: [1, 0, 0] },
      { number: 2, centroid: [0, 1, 0] },
    ];
    expect(
      matchVoiceNumbers(
        [
          [0, 1, 0.1],
          [1, 0.1, 0],
        ],
        known,
      ),
    ).toEqual([2, 1]);
  });

  it('does not reuse a number for a stranger: a new voice gets a number nobody had', () => {
    const known = [
      { number: 1, centroid: [1, 0, 0] },
      { number: 2, centroid: [0, 1, 0] },
    ];
    expect(
      matchVoiceNumbers(
        [
          [0, 0, 1],
          [1, 0, 0],
        ],
        known,
      ),
    ).toEqual([3, 1]);
  });

  it('joins each known voice once, and falls back to numbers without a print', () => {
    const known = [
      { number: 1, centroid: [1, 0] },
      { number: 2, centroid: null },
    ];
    expect(
      matchVoiceNumbers(
        [
          [1, 0],
          [1, 0.05],
        ],
        known,
      ),
    ).toEqual([1, 2]);
    expect(matchVoiceNumbers([[0.2, 1]], [])).toEqual([1]);
  });
});
