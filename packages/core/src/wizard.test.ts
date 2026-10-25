import { eq, settings as settingsTable } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingsStore } from './settings.js';
import { loadWizard, saveWizard } from './wizard.js';

describe('wizard state', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('counts as completed for installs that never started it', async () => {
    expect(await loadWizard(store)).toEqual({ completed: true, step: 'transcription' });
  });

  it('remembers the step and reopens from the start', async () => {
    await saveWizard(store, { completed: false, step: 'calendar' });
    expect(await loadWizard(store)).toEqual({ completed: false, step: 'calendar' });

    await saveWizard(store, { completed: true });
    expect(await loadWizard(store)).toEqual({ completed: true, step: 'calendar' });
  });

  it('falls back to the first step for an unknown stored step', async () => {
    await test.db
      .update(settingsTable)
      .set({ value: 'bogus' })
      .where(eq(settingsTable.key, 'wizard.step'));
    expect((await loadWizard(store)).step).toBe('transcription');
  });
});
