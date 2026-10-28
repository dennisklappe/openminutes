import { settings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadVoiceTuning, parseVoiceTuning, VOICE_TUNING_DEFAULTS } from './voice-tuning.js';

describe('parseVoiceTuning', () => {
  it('uses the defaults when nothing is set', () => {
    expect(parseVoiceTuning({})).toEqual(VOICE_TUNING_DEFAULTS);
    expect(VOICE_TUNING_DEFAULTS).toMatchObject({
      readySeconds: 120,
      readyMeetings: 5,
      readyWays: 5,
    });
  });

  it('takes valid values and ignores bad or out of range ones', () => {
    const tuning = parseVoiceTuning({
      'voices.ready_seconds': '60',
      'voices.ready_meetings': 'many',
      'voices.agree_score': '2',
      'voices.merge_similarity': '0.5',
      'voices.ready_ways': '',
    });
    expect(tuning).toEqual({
      ...VOICE_TUNING_DEFAULTS,
      readySeconds: 60,
      mergeSimilarity: 0.5,
    });
  });
});

describe('loadVoiceTuning', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  it('reads the settings of the database', async () => {
    expect(await loadVoiceTuning(test.db)).toEqual(VOICE_TUNING_DEFAULTS);
    await test.db
      .insert(settings)
      .values({ key: 'voices.ready_seconds', value: '90', secret: false });
    expect((await loadVoiceTuning(test.db)).readySeconds).toBe(90);
  });
});
