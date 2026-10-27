import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioStorage, LocalStorage, mergedAudioPath } from '@openminutes/core';
import {
  eq,
  meetings,
  participants,
  people,
  transcriptSegments,
  voiceSamples,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Diarizer, EmbeddedLines } from '@openminutes/providers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { learnVoice } from './learn-voice.js';

describe('learnVoice', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: AudioStorage;
  beforeAll(async () => {
    test = await createTestDatabase();
    storage = new AudioStorage(new LocalStorage(await mkdtemp(join(tmpdir(), 'om-learn-'))));
  });
  afterAll(() => test.close());

  async function setup(values: Partial<typeof participants.$inferInsert> = {}) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Call', platform: 'recording', joinUrl: '' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const [person] = await test.db
      .insert(participants)
      .values({ meetingId: meeting.id, displayName: 'Anna', ...values })
      .returning();
    if (!person) throw new Error('insert failed');
    const rows = await test.db
      .insert(transcriptSegments)
      .values([
        { meetingId: meeting.id, participantId: person.id, startMs: 0, endMs: 3000, text: 'long' },
        {
          meetingId: meeting.id,
          participantId: person.id,
          startMs: 3000,
          endMs: 3500,
          text: 'brief',
        },
        {
          meetingId: meeting.id,
          participantId: person.id,
          startMs: 4000,
          endMs: 7000,
          text: 'another long one',
        },
      ])
      .returning();
    const path = storage.local.absolutePath(mergedAudioPath(meeting.id));
    await storage.local.write(mergedAudioPath(meeting.id), new Uint8Array([1]));
    return {
      meeting,
      person,
      ids: rows.toSorted((a, b) => a.startMs - b.startMs).map((r) => r.id),
      path,
    };
  }

  const deps = (embedEach: Diarizer['embedEach']) => ({
    db: test.db,
    loadStorage: () => Promise.resolve(storage),
    createDiarizer: () =>
      Promise.resolve({
        diarize: () => Promise.resolve(undefined),
        embed: () => Promise.resolve(undefined),
        embedEach,
      }),
  });
  const lines = (...embeddings: (number[] | null)[]): EmbeddedLines => ({
    embeddings,
    model: 'test-model',
  });

  it('embeds the long enough lines one by one and averages them into the participant', async () => {
    const { meeting, person, ids, path } = await setup({ voiceEmbedding: [1, 0] });
    const embedEach = vi.fn(() => Promise.resolve(lines([0, 1], [0, 1])));
    await learnVoice(deps(embedEach), {
      meetingId: meeting.id,
      participantId: person.id,
      segmentIds: ids,
    });
    expect(embedEach).toHaveBeenCalledWith({ path }, [
      expect.objectContaining({ startMs: 0, endMs: 3000 }),
      expect.objectContaining({ startMs: 4000, endMs: 7000 }),
    ]);
    const [row] = await test.db.select().from(participants).where(eq(participants.id, person.id));
    expect(row?.voiceEmbedding?.map((v) => Math.round(v * 100) / 100)).toEqual([0.8, 0.2]);
    expect(await test.db.select().from(voiceSamples)).toEqual([]);
  });

  it('adds a sample per line to the person once the name is confirmed', async () => {
    const { meeting, person, ids } = await setup({ nameConfirmed: true, displayName: 'Bram' });
    await learnVoice(
      deps(() => Promise.resolve(lines([0.5, 0.5], null))),
      { meetingId: meeting.id, participantId: person.id, segmentIds: ids },
    );
    const [bram] = await test.db.select().from(people).where(eq(people.name, 'Bram'));
    const samples = await test.db
      .select()
      .from(voiceSamples)
      .where(eq(voiceSamples.personId, bram?.id ?? ''));
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      kind: 'line',
      segmentId: ids[0],
      embedding: [0.5, 0.5],
      embedder: 'test-model',
      durationMs: 3000,
      rejected: false,
    });
    expect(bram?.voicePrototypes).toHaveLength(1);
    const [row] = await test.db.select().from(participants).where(eq(participants.id, person.id));
    expect(row).toMatchObject({ voiceEmbedding: [0.5, 0.5], personId: bram?.id });
  });

  it('tags each sample with the language of its line, else of the meeting', async () => {
    const { meeting, person, ids } = await setup({ nameConfirmed: true, displayName: 'Dora' });
    await test.db.update(meetings).set({ language: 'nl' }).where(eq(meetings.id, meeting.id));
    await test.db
      .update(transcriptSegments)
      .set({ language: 'en' })
      .where(eq(transcriptSegments.id, ids[2] ?? ''));
    await learnVoice(
      deps(() => Promise.resolve(lines([1, 0], [0, 1]))),
      { meetingId: meeting.id, participantId: person.id, segmentIds: ids },
    );
    const [dora] = await test.db.select().from(people).where(eq(people.name, 'Dora'));
    const samples = await test.db
      .select()
      .from(voiceSamples)
      .where(eq(voiceSamples.personId, dora?.id ?? ''));
    expect(samples.map((x) => [x.segmentId, x.language]).sort()).toEqual(
      [
        [ids[0], 'nl'],
        [ids[2], 'en'],
      ].sort(),
    );
    expect(dora?.voicePrototypes.map((p) => p.language).sort()).toEqual(['en', 'nl']);
  });

  it('counts a line once when it is learned again', async () => {
    const { meeting, person, ids } = await setup({ nameConfirmed: true, displayName: 'Cleo' });
    const payload = { meetingId: meeting.id, participantId: person.id, segmentIds: ids };
    await learnVoice(
      deps(() => Promise.resolve(lines([1, 0], [1, 0]))),
      payload,
    );
    await learnVoice(
      deps(() => Promise.resolve(lines([1, 0], [0, 1]))),
      payload,
    );
    const [cleo] = await test.db.select().from(people).where(eq(people.name, 'Cleo'));
    expect(
      await test.db
        .select()
        .from(voiceSamples)
        .where(eq(voiceSamples.personId, cleo?.id ?? '')),
    ).toHaveLength(2);
  });

  it('leaves everything alone without an embedding, without long lines, and on failures', async () => {
    const { meeting, person, ids } = await setup({ voiceEmbedding: [1, 0] });
    const payload = { meetingId: meeting.id, participantId: person.id, segmentIds: ids };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await learnVoice(
      deps(() => Promise.resolve(undefined)),
      payload,
    );
    await learnVoice(
      deps(() => Promise.reject(new Error('whisper is down'))),
      payload,
    );
    const short = vi.fn(() => Promise.resolve(lines([0, 1])));
    await learnVoice(deps(short), { ...payload, segmentIds: [ids[1] ?? ''] });
    expect(short).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    const [row] = await test.db.select().from(participants).where(eq(participants.id, person.id));
    expect(row?.voiceEmbedding).toEqual([1, 0]);
  });

  describe('the mixed line guard', () => {
    // Whole lines first, then the halves of the lines of at least 4 s.
    const guarded = (whole: (number[] | null)[], halves: (number[] | null)[]) => {
      const embedEach = vi
        .fn<Diarizer['embedEach']>()
        .mockResolvedValueOnce(lines(...whole))
        .mockResolvedValueOnce(lines(...halves));
      return embedEach;
    };
    const longLines = async (ids: string[]) => {
      await test.db
        .update(transcriptSegments)
        .set({ endMs: 6000 })
        .where(eq(transcriptSegments.id, ids[0] ?? ''));
      await test.db
        .update(transcriptSegments)
        .set({ endMs: 11_000 })
        .where(eq(transcriptSegments.id, ids[2] ?? ''));
    };
    const samplesOf = async (name: string) => {
      const [owner] = await test.db.select().from(people).where(eq(people.name, name));
      if (!owner) return [];
      return test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, owner.id));
    };
    const flag = async (id: string | undefined) =>
      (
        await test.db
          .select()
          .from(transcriptSegments)
          .where(eq(transcriptSegments.id, id ?? ''))
      )[0]?.mixed;

    it('keeps a line of two voices out of the profile and flags it as probable', async () => {
      const { meeting, person, ids } = await setup({ nameConfirmed: true, displayName: 'Eva' });
      await longLines(ids);
      // Line 1 has halves of one voice, line 3 halves of two voices.
      const embedEach = guarded(
        [
          [1, 0],
          [0, 1],
        ],
        [
          [1, 0],
          [0.9, 0.1],
          [1, 0],
          [0, 1],
        ],
      );
      await learnVoice(deps(embedEach), {
        meetingId: meeting.id,
        participantId: person.id,
        segmentIds: ids,
      });
      expect(embedEach).toHaveBeenCalledTimes(2);
      expect(embedEach.mock.calls[1]?.[1]).toHaveLength(4);
      const samples = await samplesOf('Eva');
      expect(samples.map((s) => s.segmentId)).toEqual([ids[0]]);
      expect(await flag(ids[0])).toBeNull();
      expect(await flag(ids[2])).toBe('probable');
      const [row] = await test.db.select().from(participants).where(eq(participants.id, person.id));
      expect(row?.voiceEmbedding).toEqual([1, 0]);
    });

    it('skips lines a person marked as mixed or that are still probable, without embedding them', async () => {
      const { meeting, person, ids } = await setup({ nameConfirmed: true, displayName: 'Finn' });
      await test.db
        .update(transcriptSegments)
        .set({ mixed: 'marked' })
        .where(eq(transcriptSegments.id, ids[0] ?? ''));
      await test.db
        .update(transcriptSegments)
        .set({ mixed: 'probable' })
        .where(eq(transcriptSegments.id, ids[2] ?? ''));
      const embedEach = vi.fn(() => Promise.resolve(lines([1, 0])));
      await learnVoice(deps(embedEach), {
        meetingId: meeting.id,
        participantId: person.id,
        segmentIds: ids,
      });
      expect(embedEach).not.toHaveBeenCalled();
      expect(await samplesOf('Finn')).toEqual([]);
      expect(await flag(ids[0])).toBe('marked');
    });

    it('never turns a marked line into a probable one', async () => {
      const { meeting, person, ids } = await setup({ nameConfirmed: true, displayName: 'Gijs' });
      await longLines(ids);
      // The mark is set after the line was picked: simulate by racing the update in the embed call.
      const embedEach = vi
        .fn<Diarizer['embedEach']>()
        .mockImplementationOnce(async () => {
          await test.db
            .update(transcriptSegments)
            .set({ mixed: 'marked' })
            .where(eq(transcriptSegments.id, ids[2] ?? ''));
          return lines([1, 0], [0, 1]);
        })
        .mockResolvedValueOnce(lines([1, 0], [0, 1], [1, 0], [0, 1]));
      await learnVoice(deps(embedEach), {
        meetingId: meeting.id,
        participantId: person.id,
        segmentIds: ids,
      });
      expect(await flag(ids[2])).toBe('marked');
      expect(await flag(ids[0])).toBe('probable');
    });

    it('fails open: an unavailable embedder for the halves does not block learning', async () => {
      const { meeting, person, ids } = await setup({ nameConfirmed: true, displayName: 'Hanna' });
      await longLines(ids);
      const embedEach = vi
        .fn<Diarizer['embedEach']>()
        .mockResolvedValueOnce(lines([1, 0], [0, 1]))
        .mockRejectedValueOnce(new Error('voice service is down'));
      await learnVoice(deps(embedEach), {
        meetingId: meeting.id,
        participantId: person.id,
        segmentIds: ids,
      });
      expect(await samplesOf('Hanna')).toHaveLength(2);
      expect(await flag(ids[0])).toBeNull();
    });

    it('does not check lines under the guard length', async () => {
      const { meeting, person, ids } = await setup({ nameConfirmed: true, displayName: 'Iris' });
      const embedEach = vi.fn(() => Promise.resolve(lines([1, 0], [0, 1])));
      await learnVoice(deps(embedEach), {
        meetingId: meeting.id,
        participantId: person.id,
        segmentIds: ids,
      });
      expect(embedEach).toHaveBeenCalledTimes(1);
      expect(await samplesOf('Iris')).toHaveLength(2);
    });
  });

  it('learns nothing for a person marked do not track, not even on the participant', async () => {
    const { meeting, person, ids } = await setup({ nameConfirmed: true, displayName: 'Dirk' });
    const [dirk] = await test.db
      .insert(people)
      .values({ name: 'Dirk', tracking: 'off' })
      .returning();
    await test.db
      .update(participants)
      .set({ personId: dirk?.id ?? null })
      .where(eq(participants.id, person.id));
    const embedEach = vi.fn(() => Promise.resolve(lines([0.5, 0.5], [0.5, 0.5])));
    await learnVoice(deps(embedEach), {
      meetingId: meeting.id,
      participantId: person.id,
      segmentIds: ids,
    });
    expect(embedEach).not.toHaveBeenCalled();
    const [row] = await test.db.select().from(participants).where(eq(participants.id, person.id));
    expect(row?.voiceEmbedding).toBeNull();
    expect(
      await test.db
        .select()
        .from(voiceSamples)
        .where(eq(voiceSamples.personId, dirk?.id ?? '')),
    ).toEqual([]);
  });

  it('never stores the voice of a shared tile for one person', async () => {
    const { meeting, person, ids } = await setup({
      nameConfirmed: true,
      displayName: 'Jo and Sam',
      email: 'room@example.com',
      roomCount: 2,
    });
    const embedEach = vi.fn(() => Promise.resolve(lines([0.5, 0.5], [0.5, 0.5])));
    await learnVoice(deps(embedEach), {
      meetingId: meeting.id,
      participantId: person.id,
      segmentIds: ids,
    });
    expect(embedEach).not.toHaveBeenCalled();
    const [row] = await test.db.select().from(participants).where(eq(participants.id, person.id));
    expect(row?.voiceEmbedding).toBeNull();
    expect(await test.db.select().from(people).where(eq(people.name, 'Jo and Sam'))).toEqual([]);
  });
});
