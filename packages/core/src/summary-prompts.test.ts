import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingsStore } from './settings.js';
import {
  BUILTIN_PROMPT_ID,
  createPrompt,
  deletePrompt,
  findPrompt,
  listPrompts,
  PromptNotFoundError,
  setDefaultPrompt,
  updatePrompt,
} from './summary-prompts.js';

describe('summary prompts', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('starts with the built-in prompt as the default', async () => {
    const { prompts, defaultId } = await listPrompts(store);
    expect(prompts.map((p) => [p.id, p.builtin])).toEqual([[BUILTIN_PROMPT_ID, true]]);
    expect(prompts[0]?.content).toContain('## Action items');
    expect(defaultId).toBe(BUILTIN_PROMPT_ID);
    expect((await findPrompt(store)).id).toBe(BUILTIN_PROMPT_ID);
  });

  it('creates, edits and chooses a custom default', async () => {
    const created = await createPrompt(store, { name: 'Standup', content: 'List blockers.' });
    expect(created.builtin).toBe(false);
    await updatePrompt(store, created.id, {
      name: 'Standup notes',
      content: 'List blockers only.',
    });
    await setDefaultPrompt(store, created.id);

    const { prompts, defaultId } = await listPrompts(store);
    expect(defaultId).toBe(created.id);
    expect(prompts.find((p) => p.id === created.id)).toMatchObject({
      name: 'Standup notes',
      content: 'List blockers only.',
    });
    expect((await findPrompt(store)).name).toBe('Standup notes');
    expect((await findPrompt(store, BUILTIN_PROMPT_ID)).builtin).toBe(true);
  });

  it('falls back to the built-in default when the default is deleted', async () => {
    const { defaultId } = await listPrompts(store);
    await deletePrompt(store, defaultId);
    expect((await listPrompts(store)).defaultId).toBe(BUILTIN_PROMPT_ID);
  });

  it('rejects unknown ids and never edits the built-in prompt', async () => {
    const input = { name: 'x', content: 'y' };
    await expect(updatePrompt(store, BUILTIN_PROMPT_ID, input)).rejects.toBeInstanceOf(
      PromptNotFoundError,
    );
    await expect(deletePrompt(store, BUILTIN_PROMPT_ID)).rejects.toBeInstanceOf(
      PromptNotFoundError,
    );
    await expect(setDefaultPrompt(store, 'nope')).rejects.toBeInstanceOf(PromptNotFoundError);
    await expect(findPrompt(store, 'nope')).rejects.toBeInstanceOf(PromptNotFoundError);
  });
});
