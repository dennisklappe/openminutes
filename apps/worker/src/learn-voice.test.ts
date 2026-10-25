import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioStorage, LocalStorage, mergedAudioPath } from '@openminutes/core';
import { eq, knownVoices, meetings, participants, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Diarizer } from '@openminutes/providers';
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
      ])
      .returning();
    const path = storage.local.absolutePath(mergedAudioPath(meeting.id));
    await storage.local.write(mergedAudioPath(meeting.id), new Uint8Array([1]));
    return { meeting, person, ids: rows.map((row) => row.id), path };
  }

  const deps = (embed: Diarizer['embed']) => ({
    db: test.db,
    loadStorage: () => Promise.resolve(storage),
    createDiarizer: () => Promise.resolve({ diarize: () => Promise.resolve(undefined), embed }),
  });

  it('embeds the long enough lines and averages them into the voice', async () => {
    const { meeting, person, ids, path } = await setup({ voiceEmbedding: [1, 0] });
    const embed = vi.fn(() => Promise.resolve([0, 1]));
    await learnVoice(deps(embed), {
      meetingId: meeting.id,
      participantId: person.id,
      segmentIds: ids,
    });
    expect(embed).toHaveBeenCalledWith({ path }, [
      expect.objectContaining({ startMs: 0, endMs: 3000 }),
    ]);
    const [row] = await test.db.select().from(participants).where(eq(participants.id, person.id));
    expect(row?.voiceEmbedding?.map((v) => Math.round(v * 100) / 100)).toEqual([0.8, 0.2]);
    expect(await test.db.select().from(knownVoices).where(eq(knownVoices.name, 'Anna'))).toEqual(
      [],
    );
  });

  it('remembers the voice under the name once the name is confirmed', async () => {
    const { meeting, person, ids } = await setup({ nameConfirmed: true, displayName: 'Bram' });
    await learnVoice(
      deps(() => Promise.resolve([0.5, 0.5])),
      {
        meetingId: meeting.id,
        participantId: person.id,
        segmentIds: ids,
      },
    );
    const [known] = await test.db.select().from(knownVoices).where(eq(knownVoices.name, 'Bram'));
    expect(known?.embedding).toEqual([0.5, 0.5]);
    const [row] = await test.db.select().from(participants).where(eq(participants.id, person.id));
    expect(row?.voiceEmbedding).toEqual([0.5, 0.5]);
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
    const short = vi.fn(() => Promise.resolve([0, 1]));
    await learnVoice(deps(short), { ...payload, segmentIds: [ids[1] ?? ''] });
    expect(short).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    const [row] = await test.db.select().from(participants).where(eq(participants.id, person.id));
    expect(row?.voiceEmbedding).toEqual([1, 0]);
  });
});
