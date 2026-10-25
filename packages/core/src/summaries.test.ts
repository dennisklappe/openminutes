import { eq, meetings, summaries } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JobPayloads } from './jobs.js';
import { saveProviderSettings } from './provider-settings.js';
import { SettingsStore } from './settings.js';
import {
  createConfiguredSummarizer,
  listSummaryProviders,
  requestSummary,
  SummaryNotConfiguredError,
} from './summaries.js';
import { createPrompt, PromptNotFoundError } from './summary-prompts.js';

describe('summaries', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;
  let meetingId: string;
  const sent: JobPayloads['meeting.summarize'][] = [];
  const queue = {
    send: (_name: string, payload: unknown) => {
      sent.push(payload as JobPayloads['meeting.summarize']);
      return Promise.resolve();
    },
  };
  const deps = () => ({ db: test.db, queue, settings: store });

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 't', platform: 'meet', joinUrl: 'https://meet.google.com/abc' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    meetingId = meeting.id;
  });
  afterAll(() => test.close());

  it('refuses while no provider is configured', async () => {
    await expect(requestSummary(deps(), meetingId)).rejects.toBeInstanceOf(
      SummaryNotConfiguredError,
    );
    await expect(createConfiguredSummarizer(store)).rejects.toBeInstanceOf(
      SummaryNotConfiguredError,
    );
    expect(await listSummaryProviders(store)).toEqual({ active: 'none', configured: [] });
  });

  it('queues a pending summary for the active provider and default prompt', async () => {
    await saveProviderSettings(store, 'summary', 'openai-compatible', {
      baseUrl: 'http://llm:11434/v1',
      model: 'llama3',
    });
    const summary = await requestSummary(deps(), meetingId);
    expect(summary).toMatchObject({
      provider: 'openai-compatible',
      model: 'llama3',
      promptId: 'default',
      status: 'pending',
      content: '',
    });
    expect(sent).toEqual([{ summaryId: summary.id }]);
    expect(await listSummaryProviders(store)).toEqual({
      active: 'openai-compatible',
      configured: [expect.objectContaining({ id: 'openai-compatible' })],
    });
  });

  it('honours a prompt and a configured provider override only', async () => {
    await saveProviderSettings(store, 'summary', 'anthropic', { apiKey: 'sk-ant' });
    const prompt = await createPrompt(store, { name: 'Short', content: 'One line.' });
    const summary = await requestSummary(deps(), meetingId, {
      promptId: prompt.id,
      provider: 'openai-compatible',
    });
    expect(summary).toMatchObject({ provider: 'openai-compatible', promptId: prompt.id });

    await expect(requestSummary(deps(), meetingId, { provider: 'none' })).rejects.toBeInstanceOf(
      SummaryNotConfiguredError,
    );
    await expect(requestSummary(deps(), meetingId, { promptId: 'nope' })).rejects.toBeInstanceOf(
      PromptNotFoundError,
    );
    const rows = await test.db.select().from(summaries).where(eq(summaries.meetingId, meetingId));
    expect(rows).toHaveLength(2);
  });
});
