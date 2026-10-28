import { addVoiceSamples, rememberCount } from '@openminutes/core';
import {
  eq,
  meetings,
  participants,
  people,
  roomVoices,
  transcriptSegments,
  voiceSamples,
} from '@openminutes/db';
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

  describe('how many people', () => {
    const askedOf = async (id: string) => {
      const [row] = await test.db.select().from(participants).where(eq(participants.id, id));
      return row;
    };
    const unnamed = () => test.db.select().from(people).where(eq(people.unnamed, true));

    it('raises the question for a flagged tile that is not remembered, and makes nobody yet', async () => {
      const { meeting, room, lines } = await setup([ANNA, BRAM], [5, 4]);
      const before = (await unnamed()).length;
      await saveRoomVoices(test.db, meeting.id, lines);
      const tile = await askedOf(room.id);
      expect(tile?.roomAskedAt).not.toBeNull();
      expect(tile?.roomCount).toBeNull();
      expect((await unnamed()).length).toBe(before);
      expect((await stored(meeting.id)).every((v) => v.personId === null)).toBe(true);
    });

    it('does not ask about a tile with one voice', async () => {
      const { meeting, room, lines } = await setup([ANNA], [9]);
      await saveRoomVoices(test.db, meeting.id, lines);
      expect((await askedOf(room.id))?.roomAskedAt).toBeNull();
    });

    it('skips the question for a remembered account and uses its count right away', async () => {
      const { meeting, room, lines } = await setup([ANNA, BRAM], [5, 4]);
      await rememberCount(test.db, { email: null, displayName: 'Meeting room' }, 2);
      expect(await saveRoomVoices(test.db, meeting.id, lines)).toBe(2);
      const tile = await askedOf(room.id);
      expect(tile?.roomAskedAt).toBeNull();
      expect(tile?.roomCount).toBe(2);
      const voices = await stored(meeting.id);
      expect(voices.every((v) => v.personId !== null)).toBe(true);
      const made = await test.db.select().from(people).where(eq(people.unnamed, true));
      expect(made.map((p) => p.name)).toEqual(
        expect.arrayContaining(['Voice 1 (Meeting room)', 'Voice 2 (Meeting room)']),
      );
      // The tile's own voice is not stored for either of them.
      const seats = await test.db
        .select()
        .from(participants)
        .where(eq(participants.meetingId, meeting.id));
      expect(seats.filter((s) => s.personId).every((s) => s.voiceEmbedding === null)).toBe(true);
      // Processing again keeps the same people.
      const ids = voices.map((v) => v.personId).toSorted();
      await saveRoomVoices(test.db, meeting.id, lines);
      expect((await stored(meeting.id)).map((v) => v.personId).toSorted()).toEqual(ids);
      await test.db.delete(people).where(eq(people.unnamed, true));
    });

    it('uses the remembered count as the number of clusters, even for voices that sound alike', async () => {
      const close = [1, 0.5, 0, 0];
      const { meeting, room, lines } = await setup([ANNA, close], [5, 4]);
      await test.db.update(participants).set({ roomCount: 2 }).where(eq(participants.id, room.id));
      expect(await saveRoomVoices(test.db, meeting.id, lines)).toBe(2);
      expect(await stored(meeting.id)).toHaveLength(2);
      await test.db.delete(people).where(eq(people.unnamed, true));
    });

    it('does nothing for a remembered account of one person', async () => {
      const { meeting, lines } = await setup([ANNA, BRAM], [5, 4]);
      await test.db.delete(participants).where(eq(participants.displayName, 'Remote Rita'));
      await rememberCount(test.db, { email: null, displayName: 'Meeting room' }, 1);
      expect(await saveRoomVoices(test.db, meeting.id, lines)).toBe(0);
      await rememberCount(test.db, { email: null, displayName: 'Meeting room' }, 2);
    });

    it('gives the same person to the same voice in the next meeting, even when the order flips', async () => {
      const tileKey = { email: null, displayName: 'Meeting room' };
      await rememberCount(test.db, tileKey, 2);
      const first = await setup([ANNA, BRAM], [5, 4]);
      await saveRoomVoices(test.db, first.meeting.id, first.lines);
      // Bram talks more in the second meeting, so his cluster is the biggest one now.
      const second = await setup([BRAM, ANNA], [6, 4]);
      await saveRoomVoices(test.db, second.meeting.id, second.lines);
      const idxA = ANNA.indexOf(1);
      const nearest = async (meetingId: string, index: number) =>
        (await stored(meetingId)).toSorted(
          (a, b) => (b.centroid[index] ?? 0) - (a.centroid[index] ?? 0),
        )[0]?.personId;
      expect(await nearest(second.meeting.id, idxA)).toBe(await nearest(first.meeting.id, idxA));
      expect(await nearest(second.meeting.id, BRAM.indexOf(1))).toBe(
        await nearest(first.meeting.id, BRAM.indexOf(1)),
      );
      expect(await nearest(first.meeting.id, idxA)).not.toBe(
        await nearest(first.meeting.id, BRAM.indexOf(1)),
      );
      await test.db.delete(people).where(eq(people.unnamed, true));
    });

    it('keeps separate samples and profiles for two sub-people', async () => {
      const { meeting, lines } = await setup([ANNA, BRAM], [5, 4]);
      await saveRoomVoices(test.db, meeting.id, lines);
      const [one, two] = (await stored(meeting.id)).toSorted((a, b) => a.number - b.number);
      expect(one?.personId).toBeTruthy();
      await addVoiceSamples(test.db, one?.personId ?? '', [
        { kind: 'imported', embedding: [1, 0, 0, 0] },
      ]);
      await addVoiceSamples(test.db, two?.personId ?? '', [
        { kind: 'imported', embedding: [0, 1, 0, 0] },
      ]);
      const a = await test.db
        .select()
        .from(voiceSamples)
        .where(eq(voiceSamples.personId, one?.personId ?? ''));
      const b = await test.db
        .select()
        .from(voiceSamples)
        .where(eq(voiceSamples.personId, two?.personId ?? ''));
      expect(a.map((x) => x.embedding)).toEqual([[1, 0, 0, 0]]);
      expect(b.map((x) => x.embedding)).toEqual([[0, 1, 0, 0]]);
      const [pa] = await test.db
        .select()
        .from(people)
        .where(eq(people.id, one?.personId ?? ''));
      const [pb] = await test.db
        .select()
        .from(people)
        .where(eq(people.id, two?.personId ?? ''));
      expect(JSON.stringify(pa?.voicePrototypes)).not.toBe(JSON.stringify(pb?.voicePrototypes));
    });
  });
});
