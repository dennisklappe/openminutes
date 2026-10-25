import { settings as settingsTable } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingsStore } from './settings.js';
import { loadProviderSettings, saveProviderSettings } from './provider-settings.js';
import { createConfiguredTranscriber } from './transcription-settings.js';

describe('transcription settings', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('defaults to the local provider with no stored config', async () => {
    expect(await loadProviderSettings(store, 'transcription')).toEqual({
      provider: 'local',
      configs: {},
    });
  });

  it('keeps the config of each provider and encrypts it', async () => {
    await saveProviderSettings(store, 'transcription', 'groq', { apiKey: 'gsk-abc' });
    await saveProviderSettings(store, 'transcription', 'local', { baseUrl: 'http://stub:8000' });

    expect(await loadProviderSettings(store, 'transcription')).toEqual({
      provider: 'local',
      configs: { groq: { apiKey: 'gsk-abc' }, local: { baseUrl: 'http://stub:8000' } },
    });
    const rows = await test.db.select().from(settingsTable);
    expect(rows.find((r) => r.key === 'transcription.configs')?.value).not.toContain('gsk-abc');
  });

  it('builds the selected provider from the stored config', async () => {
    const requests: string[] = [];
    const transcriber = await createConfiguredTranscriber(store, {
      fetch: (url) => {
        requests.push(url);
        return Promise.resolve(new Response('{}'));
      },
    });
    await transcriber.test();
    expect(requests).toEqual(['http://stub:8000/health']);
  });
});
