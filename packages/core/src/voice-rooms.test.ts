import { describe, expect, it } from 'vitest';
import {
  assignToRoomVoice,
  findRoomVoices,
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
