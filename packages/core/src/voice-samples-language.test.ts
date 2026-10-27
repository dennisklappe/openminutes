import { eq, meetings, people, transcriptSegments, voiceSamples } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addVoiceSamples, ensurePerson, rebuildProfile, savedVoices } from './people.js';

describe('voice samples keep their language', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  async function line(language: string | null, meetingLanguage: string | null) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'm', platform: 'recording', joinUrl: '', language: meetingLanguage })
      .returning();
    const [segment] = await test.db
      .insert(transcriptSegments)
      .values({ meetingId: meeting?.id ?? '', startMs: 0, endMs: 4000, text: 'x', language })
      .returning();
    return { meetingId: meeting?.id ?? '', segmentId: segment?.id ?? '' };
  }

  it('takes the language of the line, then of the meeting, else unknown', async () => {
    const dana = await ensurePerson(test.db, 'Dana Languages');
    const own = await line('nl', 'en');
    const inherited = await line(null, 'en-GB');
    const none = await line(null, null);
    await addVoiceSamples(test.db, dana.id, [
      { kind: 'line', embedding: [1, 0], ...own },
      { kind: 'line', embedding: [0, 1], ...inherited },
      { kind: 'line', embedding: [1, 1], ...none },
      { kind: 'imported', embedding: [1, -1], language: 'DE' },
    ]);
    const rows = await test.db
      .select()
      .from(voiceSamples)
      .where(eq(voiceSamples.personId, dana.id));
    expect(rows.map((r) => r.language).sort()).toEqual(['de', 'en', 'nl', 'und']);
  });

  it('keeps a profile per language and tags every vector', async () => {
    const eli = await ensurePerson(test.db, 'Eli Languages');
    await addVoiceSamples(test.db, eli.id, [
      { kind: 'imported', embedding: [1, 0], language: 'nl' },
      { kind: 'imported', embedding: [0, 1], language: 'en' },
    ]);
    const [saved] = await test.db.select().from(people).where(eq(people.id, eli.id));
    expect(saved?.voicePrototypes.map((p) => p.language).sort()).toEqual(['en', 'nl']);
    expect(
      (await savedVoices(test.db)).filter((v) => v.name === 'Eli Languages').map((v) => v.language),
    ).toEqual(expect.arrayContaining(['en', 'nl']));
    await test.db.delete(voiceSamples).where(eq(voiceSamples.personId, eli.id));
    await rebuildProfile(test.db, eli.id);
    const [empty] = await test.db.select().from(people).where(eq(people.id, eli.id));
    expect(empty?.voicePrototypes).toEqual([]);
  });
});
