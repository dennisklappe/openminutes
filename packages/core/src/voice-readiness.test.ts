import { addVoiceSamples, ensurePerson } from './people.js';
import { meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agreeThreshold,
  loadProfileFacts,
  readiness,
  readinessKey,
  readyProfiles,
} from './voice-readiness.js';
import { VOICE_TUNING_DEFAULTS } from './voice-tuning.js';

const tuning = VOICE_TUNING_DEFAULTS;

describe('readiness', () => {
  it('fills the Length bar at 120 s of clean speech', () => {
    const half = readiness({ verifiedMs: 60_000, autoMs: 0, meetings: 5, ways: 5 }, tuning);
    expect(half.length).toBeCloseTo(0.5);
    expect(half.ready).toBe(false);
    expect(readiness({ verifiedMs: 120_000, autoMs: 0, meetings: 5, ways: 5 }, tuning).ready).toBe(
      true,
    );
  });

  it('counts speech added by itself for less than speech a person confirmed', () => {
    const facts = { verifiedMs: 0, autoMs: 120_000, meetings: 5, ways: 5 };
    expect(readiness(facts, tuning).length).toBeCloseTo(0.4);
  });

  it('takes Variety as the weaker of meetings and ways of sounding', () => {
    const facts = { verifiedMs: 200_000, autoMs: 0 };
    expect(readiness({ ...facts, meetings: 5, ways: 2 }, tuning).variety).toBeCloseTo(0.4);
    expect(readiness({ ...facts, meetings: 1, ways: 9 }, tuning).variety).toBeCloseTo(0.2);
    expect(readiness({ ...facts, meetings: 7, ways: 9 }, tuning).variety).toBe(1);
    expect(readiness({ ...facts, meetings: 1, ways: 9 }, tuning).ready).toBe(false);
  });

  it('follows the targets of the settings', () => {
    const easy = { ...tuning, readySeconds: 30, readyMeetings: 1, readyWays: 1 };
    expect(readiness({ verifiedMs: 30_000, autoMs: 0, meetings: 1, ways: 1 }, easy).ready).toBe(
      true,
    );
  });

  it('raises the agree threshold by the margin a person earned, up to a ceiling', () => {
    expect(agreeThreshold(tuning)).toBe(0.6);
    expect(agreeThreshold(tuning, 0.1)).toBeCloseTo(0.7);
    expect(agreeThreshold(tuning, 0.9)).toBe(0.95);
  });
});

describe('loadProfileFacts', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  const meeting = async () => {
    const [row] = await test.db
      .insert(meetings)
      .values({ title: 'Sync', platform: 'meet', joinUrl: 'u', language: 'nl' })
      .returning();
    if (!row) throw new Error('insert failed');
    return row.id;
  };

  it('counts speech, meetings and ways of sounding per person and language', async () => {
    const jo = await ensurePerson(test.db, 'Jo Parker');
    const [m1, m2] = [await meeting(), await meeting()];
    await addVoiceSamples(test.db, jo.id, [
      { kind: 'line', embedding: [1, 0], durationMs: 50_000, meetingId: m1, language: 'nl' },
      { kind: 'line', embedding: [0, 1], durationMs: 40_000, meetingId: m2, language: 'nl' },
      {
        kind: 'line',
        embedding: [1, 0.1],
        durationMs: 10_000,
        meetingId: m2,
        language: 'nl',
        source: 'auto',
      },
      { kind: 'line', embedding: [1, 0], durationMs: 5000, meetingId: m1, language: 'en' },
    ]);
    const facts = await loadProfileFacts(test.db, [jo.id]);
    expect(facts.get(readinessKey(jo.id, 'nl'))).toEqual({
      verifiedMs: 90_000,
      autoMs: 10_000,
      meetings: 2,
      ways: 2,
    });
    expect(facts.get(readinessKey(jo.id, 'en'))).toMatchObject({ meetings: 1, ways: 1 });
    // A sample without a meeting (an imported voice) is one more source.
    await addVoiceSamples(test.db, jo.id, [
      { kind: 'imported', embedding: [1, 0], durationMs: 1000, language: 'en' },
    ]);
    expect(
      (await loadProfileFacts(test.db, [jo.id])).get(readinessKey(jo.id, 'en'))?.meetings,
    ).toBe(2);
    expect((await readyProfiles(test.db, tuning, [jo.id])).size).toBe(0);
    const eager = { ...tuning, readySeconds: 60, readyMeetings: 2, readyWays: 2 };
    expect([...(await readyProfiles(test.db, eager, [jo.id]))]).toEqual([
      readinessKey(jo.id, 'nl'),
    ]);
  });
});
