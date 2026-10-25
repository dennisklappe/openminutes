import { describe, expect, it } from 'vitest';
import { MAX_ROOM_NAME, MAX_ROOM_PEOPLE, RoomTracker } from './room-tracker.js';

const room = (participants: string[], speaking: string[] = []) => ({ participants, speaking });

describe('RoomTracker', () => {
  it('records when participants join and leave', () => {
    const tracker = new RoomTracker();
    tracker.observe(room(['bot', 'Alice']), 0);
    tracker.observe(room(['bot', 'Alice', 'Bob']), 5_000);
    tracker.observe(room(['bot', 'Bob']), 9_000);
    const { participants } = tracker.finish(12_000);
    expect(participants).toEqual([
      { name: 'bot', joinedMs: 0, leftMs: 12_000 },
      { name: 'Alice', joinedMs: 0, leftMs: 9_000 },
      { name: 'Bob', joinedMs: 5_000, leftMs: 12_000 },
    ]);
  });

  it('keeps the first join when someone rejoins', () => {
    const tracker = new RoomTracker();
    tracker.observe(room(['bot', 'Alice']), 0);
    tracker.observe(room(['bot']), 2_000);
    tracker.observe(room(['bot', 'Alice']), 4_000);
    expect(tracker.finish(6_000).participants[1]).toEqual({
      name: 'Alice',
      joinedMs: 0,
      leftMs: 6_000,
    });
  });

  it('collapses continuous speech and short flickers into one interval', () => {
    const tracker = new RoomTracker();
    const people = ['bot', 'Alice'];
    for (const at of [0, 250, 500]) tracker.observe(room(people, ['Alice']), at);
    for (const at of [750, 1_000]) tracker.observe(room(people), at);
    for (const at of [1_250, 1_500]) tracker.observe(room(people, ['Alice']), at);
    expect(tracker.finish(2_000).speakerEvents).toEqual([
      { name: 'Alice', startMs: 0, endMs: 1_750 },
    ]);
  });

  it('splits intervals separated by a long pause and orders by start', () => {
    const tracker = new RoomTracker();
    const people = ['bot', 'Alice', 'Bob'];
    tracker.observe(room(people, ['Alice']), 0);
    tracker.observe(room(people, ['Bob']), 250);
    for (let at = 500; at <= 3_000; at += 250) tracker.observe(room(people), at);
    tracker.observe(room(people, ['Alice']), 4_000);
    expect(tracker.finish(5_000).speakerEvents).toEqual([
      { name: 'Alice', startMs: 0, endMs: 250 },
      { name: 'Bob', startMs: 250, endMs: 500 },
      { name: 'Alice', startMs: 4_000, endMs: 4_250 },
    ]);
  });

  it('closes a speaker who is still talking when the recording ends', () => {
    const tracker = new RoomTracker();
    tracker.observe(room(['bot', 'Alice'], ['Alice']), 1_000);
    expect(tracker.finish(1_200).speakerEvents).toEqual([
      { name: 'Alice', startMs: 1_000, endMs: 1_250 },
    ]);
  });

  it('counts the room and ignores snapshots that came back empty', () => {
    const tracker = new RoomTracker();
    expect(tracker.count).toBe(Number.POSITIVE_INFINITY);
    tracker.observe(room(['bot', 'Alice', 'Bob']), 0);
    expect(tracker.count).toBe(3);
    tracker.observe(room([]), 250);
    expect(tracker.count).toBe(3);
    expect(tracker.finish(500).participants.every((p) => p.leftMs === 500)).toBe(true);
  });

  it('counts people by headcount when two share a name', () => {
    const tracker = new RoomTracker();
    tracker.observe({ participants: ['Acme Notetaker'], speaking: [], headcount: 2 }, 0);
    expect(tracker.count).toBe(2);
    tracker.observe({ participants: ['Acme Notetaker'], speaking: [] }, 250);
    expect(tracker.count).toBe(1);
  });

  it('caps the names and the number of people it keeps', () => {
    const tracker = new RoomTracker();
    const names = Array.from({ length: MAX_ROOM_PEOPLE + 20 }, (_, i) => `Guest ${i}`);
    tracker.observe(room(['n'.repeat(900), ...names]), 0);
    const { participants } = tracker.finish(1_000);
    expect(participants).toHaveLength(MAX_ROOM_PEOPLE);
    expect(participants[0]?.name).toHaveLength(MAX_ROOM_NAME);
  });
});
