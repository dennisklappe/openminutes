import { randomUUID } from 'node:crypto';
import { defaultMeetingSummaryPrompt } from '@openminutes/providers';
import { z } from 'zod';
import type { SettingsStore } from './settings.js';

export const BUILTIN_PROMPT_ID = 'default';

export const promptInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(20_000),
});

export type PromptInput = z.infer<typeof promptInputSchema>;

export interface PromptTemplate extends PromptInput {
  id: string;
  builtin: boolean;
}

export class PromptNotFoundError extends Error {
  constructor() {
    super('Prompt not found');
    this.name = 'PromptNotFoundError';
  }
}

const storedSchema = z.array(promptInputSchema.extend({ id: z.string() }));

const builtin: PromptTemplate = {
  id: BUILTIN_PROMPT_ID,
  name: 'Meeting summary',
  content: defaultMeetingSummaryPrompt,
  builtin: true,
};

async function loadCustom(settings: SettingsStore): Promise<PromptTemplate[]> {
  const stored = storedSchema.parse(JSON.parse((await settings.get('summary.prompts')) ?? '[]'));
  return stored.map((prompt) => ({ ...prompt, builtin: false }));
}

const saveCustom = (settings: SettingsStore, prompts: PromptTemplate[]) =>
  settings.set(
    'summary.prompts',
    JSON.stringify(prompts.map(({ id, name, content }) => ({ id, name, content }))),
  );

export async function listPrompts(
  settings: SettingsStore,
): Promise<{ prompts: PromptTemplate[]; defaultId: string }> {
  const prompts = [builtin, ...(await loadCustom(settings))];
  const stored = (await settings.get('summary.default_prompt')) ?? BUILTIN_PROMPT_ID;
  return {
    prompts,
    defaultId: prompts.some((p) => p.id === stored) ? stored : BUILTIN_PROMPT_ID,
  };
}

export async function findPrompt(settings: SettingsStore, id?: string): Promise<PromptTemplate> {
  const { prompts, defaultId } = await listPrompts(settings);
  const prompt = prompts.find((p) => p.id === (id ?? defaultId));
  if (!prompt) throw new PromptNotFoundError();
  return prompt;
}

export async function createPrompt(
  settings: SettingsStore,
  input: PromptInput,
): Promise<PromptTemplate> {
  const prompt: PromptTemplate = { ...input, id: randomUUID(), builtin: false };
  await saveCustom(settings, [...(await loadCustom(settings)), prompt]);
  return prompt;
}

export async function updatePrompt(
  settings: SettingsStore,
  id: string,
  input: PromptInput,
): Promise<PromptTemplate> {
  const custom = await loadCustom(settings);
  const index = custom.findIndex((p) => p.id === id);
  if (index < 0) throw new PromptNotFoundError();
  const updated: PromptTemplate = { ...input, id, builtin: false };
  custom[index] = updated;
  await saveCustom(settings, custom);
  return updated;
}

export async function deletePrompt(settings: SettingsStore, id: string): Promise<void> {
  const custom = await loadCustom(settings);
  if (!custom.some((p) => p.id === id)) throw new PromptNotFoundError();
  await saveCustom(
    settings,
    custom.filter((p) => p.id !== id),
  );
  if ((await settings.get('summary.default_prompt')) === id) {
    await settings.set('summary.default_prompt', BUILTIN_PROMPT_ID);
  }
}

export async function setDefaultPrompt(settings: SettingsStore, id: string): Promise<void> {
  await findPrompt(settings, id);
  await settings.set('summary.default_prompt', id);
}
