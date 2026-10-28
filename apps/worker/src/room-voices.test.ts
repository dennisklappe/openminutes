import { eq, meetings, participants, roomVoices, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detect, saveRoomVoices } from './room-voices.js';
import type { EmbeddedLine } from './speaker-review/voice-check.js';

const ANNA = [1, 0, 0, 0];
const BRAM = [0, 1, 0, 0];
const jitter = (direction: number[], i: number) =>
  direction.map((value, k) => value + (k === 2 + (i % 2) ? 0.04 : 0));

describe('shared tiles', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  async function setup(voices: number[][], counts: number[], extra: Partial<EmbeddedLine>[] = []) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Room', platform: 'meet', joinUrl: 'u' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const [room, remote] = await test.db
      .insert(participants)
      .values([
        { meetingId: meeting.id, displayName: 'Meeting room' },
        { meetingId: meeting.id, displayName: 'Remote Rita' },
      ])
      .returning();
    if (!room || !remote) throw new Error('insert failed');
    const lines: EmbeddedLine[] = [];
    for (const [v, voice] of voices.entries()) {
      for (let i = 0; i < (counts[v] ?? 0); i++) {
        const n = lines.length;
        lines.push({
          startMs: n * 6000,
          endMs: n * 6000 + 5000,
          participantId: room.id,
          embedding: jitter(voice, i),
          anchor: true,
          undisturbed: true,
          ...extra[n],
        });
      }
    }
    await test.db.insert(transcriptSegments).values(
      lines.map((line, n) => ({
        meetingId: meeting.id,
        participantId: line.participantId,
        startMs: line.startMs,
        endMs: line.endMs,
        text: `Line ${String(n)}`,
      })),
    );
    return { meeting, room, remote, lines };
  }

  const stored = (meetingId: string) =>
    test.db.select().from(roomVoices).where(eq(roomVoices.meetingId, meetingId));
  const assigned = async (meetingId: string) =>
    (
      await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.meetingId, meetingId))
    )
      .toSorted((a, b) => a.startMs - b.startMs)
      .map((s) => s.roomVoiceId);

  it('flags a tile with two voices and gives each line the voice it sounds like', async () => {
    const { meeting, room, lines } = await setup([ANNA, BRAM], [5, 4]);
    expect(await saveRoomVoices(test.db, meeting.id, lines)).toBe(2);
    const voices = await stored(meeting.id);
    expect(voices.map((v) => [v.number, v.lines, v.personId])).toEqual(
      expect.arrayContaining([
        [1, 5, null],
        [2, 4, null],
      ]),
    );
    expect(voices.every((v) => v.participantId === room.id)).toBe(true);
    const ids = await assigned(meeting.id);
    expect(new Set(ids.slice(0, 5)).size).toBe(1);
    expect(new Set(ids.slice(5)).size).toBe(1);
    expect(ids[0]).not.toBe(ids[5]);
    expect(ids.every((id) => id !== null)).toBe(true);
  });

  it('does not flag a tile with one voice and changes no label', async () => {
    const { meeting, room, lines } = await setup([ANNA], [9]);
    expect(await saveRoomVoices(test.db, meeting.id, lines)).toBe(0);
    expect(await stored(meeting.id)).toEqual([]);
    const rows = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meeting.id));
    expect(rows.every((r) => r.participantId === room.id && r.roomVoiceId === null)).toBe(true);
  });

  it('remembers that the owner called the tile one person, also when the meeting runs again', async () => {
    const { meeting, room, lines } = await setup([ANNA, BRAM], [5, 4]);
    await test.db
      .update(participants)
      .set({ roomDismissedAt: new Date() })
      .where(eq(participants.id, room.id));
    expect(await saveRoomVoices(test.db, meeting.id, lines)).toBe(0);
    expect(await saveRoomVoices(test.db, meeting.id, lines)).toBe(0);
    expect(await stored(meeting.id)).toEqual([]);
  });

  it('leaves lines that overlap, are short or fit neither voice unassigned', async () => {
    const extra: Partial<EmbeddedLine>[] = [];
    extra[1] = { undisturbed: false };
    extra[2] = { endMs: 2 * 6000 + 800, anchor: false };
    extra[3] = { embedding: [0, 0, 1, 0], anchor: false };
    const { meeting, lines } = await setup([ANNA, BRAM], [6, 4], extra);
    await saveRoomVoices(test.db, meeting.id, lines);
    const ids = await assigned(meeting.id);
    expect(ids[0]).not.toBeNull();
    expect(ids[1]).toBeNull();
    expect(ids[2]).toBeNull();
    expect(ids[3]).toBeNull();
    expect(ids[4]).not.toBeNull();
  });

  it('replaces the voices of an earlier run', async () => {
    const { meeting, lines } = await setup([ANNA, BRAM], [5, 4]);
    await saveRoomVoices(test.db, meeting.id, lines);
    await saveRoomVoices(test.db, meeting.id, lines);
    expect(await stored(meeting.id)).toHaveLength(2);
    await saveRoomVoices(test.db, meeting.id, []);
    expect(await stored(meeting.id)).toEqual([]);
  });

  it('never looks at a participant who sounds like another participant of the meeting', () => {
    const rita = Array.from({ length: 4 }, (_, i) => ({
      startMs: i * 6000,
      endMs: i * 6000 + 5000,
      participantId: 'rita',
      embedding: jitter(BRAM, i),
      anchor: true,
      undisturbed: true,
    }));
    const room = Array.from({ length: 8 }, (_, i) => ({
      startMs: 100_000 + i * 6000,
      endMs: 100_000 + i * 6000 + 5000,
      participantId: 'room',
      embedding: jitter(i < 4 ? ANNA : BRAM, i),
      anchor: true,
      undisturbed: true,
    }));
    expect(detect([...rita, ...room], new Set())).toEqual([]);
    expect(detect([...room], new Set())).toHaveLength(1);
    expect(detect([...room], new Set(['room']))).toEqual([]);
  });
});
