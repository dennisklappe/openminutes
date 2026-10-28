import { eq, people, voiceSamples } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addVoiceSamples, ensurePerson, rebuildProfile, recordPrototypeHits } from './people.js';
import { PRUNE_AFTER_MS } from './voice-profile.js';

describe('pruning and usage counts of the voice profile', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  const prototypesOf = async (id: string) =>
    (await test.db.select().from(people).where(eq(people.id, id)))[0]?.voicePrototypes ?? [];

  it('stamps new vectors and never prunes them at once', async () => {
    const jo = await ensurePerson(test.db, 'Jo Prune');
    await addVoiceSamples(test.db, jo.id, [
      { kind: 'line', embedding: [1, 0], durationMs: 5000, language: 'nl' },
      { kind: 'line', embedding: [0, 1], durationMs: 5000, language: 'nl' },
    ]);
    const prototypes = await prototypesOf(jo.id);
    expect(prototypes).toHaveLength(2);
    expect(prototypes.every((p) => typeof p.createdAt === 'string')).toBe(true);
  });

  it('prunes a small vector nobody matched for a long time and keeps its sample as a line', async () => {
    const jo = await ensurePerson(test.db, 'Ann Idle');
    await addVoiceSamples(test.db, jo.id, [
      { kind: 'line', embedding: [1, 0], durationMs: 5000, language: 'nl' },
      { kind: 'line', embedding: [0, 1], durationMs: 5000, language: 'nl' },
    ]);
    const old = new Date(Date.now() - PRUNE_AFTER_MS - 60_000).toISOString();
    const [first, second] = await prototypesOf(jo.id);
    await test.db
      .update(people)
      .set({
        voicePrototypes: [
          { ...(first ?? { vector: [], samples: 1 }), createdAt: old },
          {
            ...(second ?? { vector: [], samples: 1 }),
            createdAt: old,
            lastMatchedAt: new Date().toISOString(),
          },
        ],
      })
      .where(eq(people.id, jo.id));
    await rebuildProfile(test.db, jo.id);
    const kept = await prototypesOf(jo.id);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.vector[1]).toBeCloseTo(1);
    const samples = await test.db
      .select()
      .from(voiceSamples)
      .where(eq(voiceSamples.personId, jo.id));
    expect(samples).toHaveLength(2);
    expect(samples.filter((s) => s.prunedAt !== null)).toHaveLength(1);
    // A pruned sample stays out of the profile when it is built again.
    await rebuildProfile(test.db, jo.id);
    expect(await prototypesOf(jo.id)).toHaveLength(1);
  });

  it('records which vector a line matched and which one attracted a rejected line', async () => {
    const jo = await ensurePerson(test.db, 'Sam Hits');
    await addVoiceSamples(test.db, jo.id, [
      { kind: 'line', embedding: [1, 0], durationMs: 5000, language: 'nl' },
      { kind: 'line', embedding: [0, 1], durationMs: 5000, language: 'nl' },
    ]);
    await recordPrototypeHits(test.db, jo.id, [
      { embedding: [0.9, 0.1], language: 'nl', outcome: 'matched' },
      { embedding: [0.9, 0.1], language: 'nl', outcome: 'matched' },
      { embedding: [0.1, 0.9], language: 'nl', outcome: 'rejected' },
    ]);
    const [a, b] = await prototypesOf(jo.id);
    expect(a).toMatchObject({ matches: 2 });
    expect(a?.lastMatchedAt).toBeTypeOf('string');
    expect(b).toMatchObject({ rejectedMatches: 1 });
    expect(b?.matches).toBeUndefined();
    await rebuildProfile(test.db, jo.id);
    expect((await prototypesOf(jo.id))[0]).toMatchObject({ matches: 2 });
    // A vector that only attracted rejected lines is pruned on the next build.
    expect(await prototypesOf(jo.id)).toHaveLength(1);
  });
});
