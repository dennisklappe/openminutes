import { eq, participants, meetings, people, voiceSamples } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchVoices } from './voices.js';
import {
  addVoiceSamples,
  ensurePerson,
  forgetVoices,
  isTracked,
  rememberVoice,
  resumeTracking,
  savedVoices,
  stopTracking,
} from './people.js';

describe('do not track', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  it('deletes the samples, the profile and the participant voices, and keeps the name', async () => {
    const anna = await ensurePerson(test.db, 'Anna Tracked');
    await addVoiceSamples(test.db, anna.id, [
      { kind: 'imported', embedding: [1, 0] },
      { kind: 'imported', embedding: [0, 1] },
    ]);
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'm', platform: 'recording', joinUrl: '' })
      .returning();
    const [seat] = await test.db
      .insert(participants)
      .values({
        meetingId: meeting?.id ?? '',
        displayName: 'Anna Tracked',
        personId: anna.id,
        voiceEmbedding: [1, 0],
      })
      .returning();
    expect((await savedVoices(test.db)).some((v) => v.name === 'Anna Tracked')).toBe(true);

    await stopTracking(test.db, anna.id);

    const [after] = await test.db.select().from(people).where(eq(people.id, anna.id));
    expect(after).toMatchObject({ name: 'Anna Tracked', tracking: 'off', voicePrototypes: [] });
    expect(
      await test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, anna.id)),
    ).toEqual([]);
    const [kept] = await test.db
      .select()
      .from(participants)
      .where(eq(participants.id, seat?.id ?? ''));
    expect(kept).toMatchObject({ displayName: 'Anna Tracked', voiceEmbedding: null });
    expect(await isTracked(test.db, anna.id)).toBe(false);
  });

  it('learns nothing for them and never offers their voice as a name', async () => {
    const bram = await ensurePerson(test.db, 'Bram Muted');
    await stopTracking(test.db, bram.id);
    await addVoiceSamples(test.db, bram.id, [{ kind: 'imported', embedding: [1, 0] }]);
    await rememberVoice(test.db, 'Bram Muted', [1, 0], null, null);
    expect(
      await test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, bram.id)),
    ).toEqual([]);
    const known = await savedVoices(test.db);
    expect(known.some((v) => v.name === 'Bram Muted')).toBe(false);
    expect(matchVoices([1, 0], known).map((m) => m.name)).not.toContain('Bram Muted');
  });

  it('learns again after tracking resumes', async () => {
    const cleo = await ensurePerson(test.db, 'Cleo Again');
    await stopTracking(test.db, cleo.id);
    await resumeTracking(test.db, cleo.id);
    await addVoiceSamples(test.db, cleo.id, [{ kind: 'imported', embedding: [0, 1] }]);
    expect(
      await test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, cleo.id)),
    ).toHaveLength(1);
  });
});

describe('forgetVoices', () => {
  it('clears the participant voice vectors too, for one person or for everyone', async () => {
    const test = await createTestDatabase();
    try {
      const cora = await ensurePerson(test.db, 'Cora Forgot');
      const dirk = await ensurePerson(test.db, 'Dirk Stays');
      const [meeting] = await test.db
        .insert(meetings)
        .values({ title: 'm', platform: 'recording', joinUrl: '' })
        .returning();
      const seats = await test.db
        .insert(participants)
        .values([
          {
            meetingId: meeting?.id ?? '',
            displayName: 'Cora',
            personId: cora.id,
            voiceEmbedding: [1, 0],
          },
          {
            meetingId: meeting?.id ?? '',
            displayName: 'Dirk',
            personId: dirk.id,
            voiceEmbedding: [0, 1],
          },
          { meetingId: meeting?.id ?? '', displayName: 'Unlinked', voiceEmbedding: [1, 1] },
        ])
        .returning();
      const embeddingOf = async (name: string) =>
        (await test.db.select().from(participants).where(eq(participants.displayName, name)))[0]
          ?.voiceEmbedding;
      expect(seats).toHaveLength(3);

      await forgetVoices(test.db, [cora.id]);
      expect(await embeddingOf('Cora')).toBeNull();
      expect(await embeddingOf('Dirk')).toEqual([0, 1]);

      await forgetVoices(test.db);
      expect(await embeddingOf('Dirk')).toBeNull();
      expect(await embeddingOf('Unlinked')).toBeNull();
    } finally {
      await test.close();
    }
  });
});
