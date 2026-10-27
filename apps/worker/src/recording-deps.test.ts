import { saveProviderSettings, SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Diarizer } from '@openminutes/providers';
import { createRecordingDeps } from './recording-deps.js';

describe('createRecordingDeps', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  const diarizer: Diarizer = {
    diarize: () => Promise.resolve(undefined),
    embed: () => Promise.resolve(undefined),
    embedEach: () => Promise.resolve(undefined),
  };
  const configs: unknown[] = [];
  const deps = () =>
    createRecordingDeps(settings, (config) => {
      configs.push(config);
      return diarizer;
    });

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('builds a diarizer from the local whisper settings, saved or default', async () => {
    expect(await deps().createDiarizer()).toBe(diarizer);
    expect(configs.at(-1)).toEqual({ baseUrl: 'http://whisper:8000' });

    await saveProviderSettings(settings, 'transcription', 'local', {
      baseUrl: 'http://w:9000',
      token: 'secret-token',
    });
    await deps().createDiarizer();
    expect(configs.at(-1)).toEqual({ baseUrl: 'http://w:9000', token: 'secret-token' });

    await saveProviderSettings(settings, 'transcription', 'deepgram', { apiKey: 'k' });
    expect(await deps().createDiarizer()).toBe(diarizer);
    expect(configs.at(-1)).toEqual({ baseUrl: 'http://w:9000', token: 'secret-token' });
  });

  it('reads the remember setting and the optional summary provider', async () => {
    expect(await deps().voicesRemembered()).toBe(false);
    await settings.set('voices.remember', 'true');
    expect(await deps().voicesRemembered()).toBe(true);
    expect(await deps().voicesChecked()).toBe(false);
    await settings.set('voices.check', 'true');
    expect(await deps().voicesChecked()).toBe(true);
    expect(await deps().createSuggester()).toBeUndefined();
    await saveProviderSettings(settings, 'summary', 'openai-compatible', {
      baseUrl: 'http://x/v1',
      model: 'm',
      apiKey: 'k',
    });
    expect((await deps().createSuggester())?.model).toBe('m');
  });
});
