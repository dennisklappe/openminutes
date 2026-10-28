import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioStorage, LocalStorage, mergedAudioPath, rememberedCount } from '@openminutes/core';
import {
  eq,
  meetings,
  participants,
  people,
  roomVoices,
  transcriptSegments,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Diarizer } from '@openminutes/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { splitRoom } from './split-room.js';

const DIRECTIONS = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];

describe('splitRoom', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: AudioStorage;
  beforeAll(async () => {
    test = await createTestDatabase();
    storage = new AudioStorage(new LocalStorage(await mkdtemp(join(tmpdir(), 'om-split-'))));
  });
  afterAll(() => test.close());

  /** A tile with `lines` clean lines, line i sounding like direction i % voices. */
  async function setup(voices: number, lines = 8, name = 'Jo and Sam') {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Planning', platform: 'meet', joinUrl: 'https://meet.example.com/x' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const [tile] = await test.db
      .insert(participants)
      .values({ meetingId: meeting.id, displayName: name, email: 'room@example.com' })
      .returning();
    if (!tile) throw new Error('insert failed');
    await test.db.insert(transcriptSegments).values(
      Array.from({ length: lines }, (_, i) => ({
        meetingId: meeting.id,
        participantId: tile.id,
        startMs: i * 5000,
        endMs: i * 5000 + 4000,
        text: `line ${String(i)}`,
        speakerSource: 'indicator' as const,
        speakerConfidence: 0.95,
      })),
    );
    await storage.local.write(mergedAudioPath(meeting.id), new Uint8Array([1]));
    // The web API sets the count and the time before it queues the job.
    await test.db
      .update(participants)
      .set({ roomCount: voices, roomAskedAt: new Date() })
      .where(eq(participants.id, tile.id));
    return { meeting, tile };
  }

  const diarizer = (embed: Diarizer['embedEach']) => ({
    db: test.db,
    loadStorage: () => Promise.resolve(storage),
    createDiarizer: () => Promise.resolve({ embedEach: embed } as unknown as Diarizer),
  });
  const bySound =
    (voices: number): Diarizer['embedEach'] =>
    (_audio, ranges) =>
      Promise.resolve({
        model: 'fake',
        embeddings: ranges.map((range) => {
          const i = range.startMs / 5000;
          const base = DIRECTIONS[i % voices] ?? [1, 0, 0, 0];
          return base.map((value, k) => value + (k === 3 ? 0.02 * (i % 3) : 0));
        }),
      });
  const tileOf = async (id: string) =>
    (await test.db.select().from(participants).where(eq(participants.id, id)))[0];

  it('splits the tile into the asked number of voices and makes a person for each', async () => {
    const { meeting, tile } = await setup(2);
    await splitRoom(diarizer(bySound(2)), {
      meetingId: meeting.id,
      participantId: tile.id,
      count: 2,
    });
    const voices = await test.db
      .select()
      .from(roomVoices)
      .where(eq(roomVoices.meetingId, meeting.id));
    expect(voices).toHaveLength(2);
    expect(voices.every((v) => v.personId !== null)).toBe(true);
    const after = await tileOf(tile.id);
    expect(after?.roomCount).toBe(2);
    expect(after?.roomAskedAt).toBeNull();
    expect(await rememberedCount(test.db, tile)).toBe(2);
    const lines = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meeting.id));
    expect(lines.every((l) => l.participantId !== tile.id)).toBe(true);
    expect(new Set(lines.map((l) => l.participantId)).size).toBe(2);
  });

  it('uses the asked count, three voices for three people', async () => {
    const { meeting, tile } = await setup(3, 9, 'Trio');
    await splitRoom(diarizer(bySound(3)), {
      meetingId: meeting.id,
      participantId: tile.id,
      count: 3,
    });
    expect(
      await test.db.select().from(roomVoices).where(eq(roomVoices.meetingId, meeting.id)),
    ).toHaveLength(3);
  });

  it('splits again with another count, and a smaller count drops the spare person', async () => {
    const { meeting, tile } = await setup(3, 9, 'Again');
    await splitRoom(diarizer(bySound(3)), {
      meetingId: meeting.id,
      participantId: tile.id,
      count: 3,
    });
    await test.db
      .update(participants)
      .set({ roomCount: 2, roomAskedAt: new Date() })
      .where(eq(participants.id, tile.id));
    await splitRoom(diarizer(bySound(2)), {
      meetingId: meeting.id,
      participantId: tile.id,
      count: 2,
    });
    expect(
      await test.db.select().from(roomVoices).where(eq(roomVoices.meetingId, meeting.id)),
    ).toHaveLength(2);
    const seats = await test.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, meeting.id));
    expect(seats.filter((s) => s.personId)).toHaveLength(2);
    const spare = await test.db.select().from(people).where(eq(people.name, 'Voice 3 (Again)'));
    expect(spare).toEqual([]);
  });

  it('leaves the tile as it was when the lines do not split that way', async () => {
    const { meeting, tile } = await setup(2, 8, 'One voice');
    await splitRoom(diarizer(bySound(1)), {
      meetingId: meeting.id,
      participantId: tile.id,
      count: 4,
    });
    const after = await tileOf(tile.id);
    expect(after?.roomCount).toBeNull();
    expect(after?.roomAskedAt).toBeNull();
    expect(
      await test.db.select().from(roomVoices).where(eq(roomVoices.meetingId, meeting.id)),
    ).toEqual([]);
    const lines = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meeting.id));
    expect(lines.every((l) => l.participantId === tile.id)).toBe(true);
  });

  it('fails cleanly without the voice service', async () => {
    const { meeting, tile } = await setup(2, 8, 'No service');
    await splitRoom(
      { ...diarizer(bySound(2)), createDiarizer: () => Promise.resolve(undefined) },
      { meetingId: meeting.id, participantId: tile.id, count: 2 },
    );
    expect((await tileOf(tile.id))?.roomAskedAt).toBeNull();
  });

  it('does not touch a tile with a named voice', async () => {
    const { meeting, tile } = await setup(2, 8, 'Named');
    await splitRoom(diarizer(bySound(2)), {
      meetingId: meeting.id,
      participantId: tile.id,
      count: 2,
    });
    const [voice] = await test.db
      .select()
      .from(roomVoices)
      .where(eq(roomVoices.meetingId, meeting.id));
    await test.db
      .update(people)
      .set({ unnamed: false })
      .where(eq(people.id, voice?.personId ?? ''));
    await test.db
      .update(participants)
      .set({ roomCount: 3, roomAskedAt: new Date() })
      .where(eq(participants.id, tile.id));
    await splitRoom(diarizer(bySound(3)), {
      meetingId: meeting.id,
      participantId: tile.id,
      count: 3,
    });
    expect(
      await test.db.select().from(roomVoices).where(eq(roomVoices.meetingId, meeting.id)),
    ).toHaveLength(2);
    expect((await tileOf(tile.id))?.roomAskedAt).toBeNull();
  });
});
