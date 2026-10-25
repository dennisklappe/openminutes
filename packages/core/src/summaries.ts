import { summaries, type Database } from '@openminutes/db';
import {
  createSummaryProvider,
  summaryProviders,
  type Deps,
  type SummaryProvider,
} from '@openminutes/providers';
import { findPrompt } from './summary-prompts.js';
import { loadEditLineage } from './summary-lineage.js';
import { loadProviderSettings } from './provider-settings.js';
import type { JobSender } from './queue.js';
import type { SettingsStore } from './settings.js';

export class SummaryNotConfiguredError extends Error {
  constructor() {
    super('No summary provider is configured');
    this.name = 'SummaryNotConfiguredError';
  }
}

export interface SummaryRequest {
  promptId?: string | undefined;
  provider?: string | undefined;
  reapplyEdits?: boolean | undefined;
}

export async function createConfiguredSummarizer(
  settings: SettingsStore,
  providerId?: string,
  deps?: Partial<Deps>,
): Promise<{ id: string; provider: SummaryProvider }> {
  const { provider: active, configs } = await loadProviderSettings(settings, 'summary');
  const id = providerId ?? active;
  if (id === 'none' || (providerId !== undefined && !configs[id])) {
    throw new SummaryNotConfiguredError();
  }
  return { id, provider: createSummaryProvider(id, configs[id] ?? {}, deps) };
}

export async function listSummaryProviders(
  settings: SettingsStore,
): Promise<{ active: string; configured: { id: string; label: string }[] }> {
  const { provider, configs } = await loadProviderSettings(settings, 'summary');
  const configured = Object.values(summaryProviders)
    .filter((definition) => definition.id !== 'none' && configs[definition.id])
    .map(({ id, label }) => ({ id, label }));
  return { active: provider, configured };
}

export async function requestSummary(
  deps: { db: Database; queue: JobSender; settings: SettingsStore },
  meetingId: string,
  request: SummaryRequest = {},
) {
  const prompt = await findPrompt(deps.settings, request.promptId);
  const { id, provider } = await createConfiguredSummarizer(deps.settings, request.provider);
  const { instructions } = request.reapplyEdits
    ? await loadEditLineage(deps.db, meetingId)
    : { instructions: [] };
  const [summary] = await deps.db
    .insert(summaries)
    .values({
      meetingId,
      provider: id,
      model: provider.model,
      promptId: prompt.id,
      replay: instructions.length > 0 ? JSON.stringify(instructions) : null,
    })
    .returning();
  if (!summary) throw new Error('Summary insert returned no row');
  await deps.queue.send('meeting.summarize', { summaryId: summary.id });
  return summary;
}
