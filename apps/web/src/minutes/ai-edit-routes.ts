import {
  createConfiguredSummarizer,
  editSummary,
  loadEditLineage,
  loadTranscriptText,
  MAX_INSTRUCTION_CHARS,
  recentInstructions,
  SummaryEditError,
  SummaryNotConfiguredError,
  type SettingsStore,
} from '@openminutes/core';
import type { Database } from '@openminutes/db';
import { ProviderError, type Deps } from '@openminutes/providers';
import { Hono } from 'hono';
import { z } from 'zod';
import { LoginRateLimiter } from '../auth/rate-limit.js';
import type { SummaryAiEditDto } from '../dto.js';
import { applyPeopleEdit } from '../participants/ai-edit.js';
import { addSummaryVersion, findDoneSummary, hasPendingSummary } from './summary-edit.js';

const EDITS_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60_000;
const uuid = z.uuid();
const input = z.object({
  instruction: z.string().trim().min(1).max(MAX_INSTRUCTION_CHARS),
  useTranscript: z.boolean().default(false),
  confirmShrink: z.boolean().default(false),
});

const STATUS = { too_large: 413, unusable: 502, unchanged: 422, shrunk: 409 } as const;

interface AiEditDeps {
  db: Database;
  settings: SettingsStore;
  providerDeps?: Partial<Deps> | undefined;
}

export function summaryAiEditRoutes(deps: AiEditDeps): Hono {
  const routes = new Hono();
  const limiter = new LoginRateLimiter(EDITS_PER_WINDOW, WINDOW_MS);
  const running = new Set<string>();

  routes.post('/:id/summary/ai-edit', async (c) => {
    const meetingId = uuid.safeParse(c.req.param('id'));
    const current = meetingId.success ? await findDoneSummary(deps.db, meetingId.data) : undefined;
    if (!meetingId.success || !current) return c.json({ error: 'Summary not found' }, 404);
    const id = meetingId.data;
    const body = input.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json(
        { error: `Write an instruction of 1 to ${MAX_INSTRUCTION_CHARS} characters` },
        400,
      );
    }
    if (running.has(id) || (await hasPendingSummary(deps.db, id))) {
      return c.json({ error: 'The summary is being changed, wait for it to finish' }, 409);
    }
    const wait = limiter.retryAfterSeconds(id);
    if (wait > 0) {
      return c.json({ error: `Too many edits, try again in ${String(wait)} seconds` }, 429);
    }

    running.add(id);
    try {
      const summarizer = await createConfiguredSummarizer(
        deps.settings,
        undefined,
        deps.providerDeps,
      );
      const transcript = body.data.useTranscript ? await loadTranscriptText(deps.db, id) : '';
      if (body.data.useTranscript && !transcript) {
        return c.json({ error: 'There is no transcript to use' }, 409);
      }
      limiter.recordFailure(id);
      const people = await applyPeopleEdit(
        deps,
        summarizer.provider,
        id,
        body.data.instruction,
        c.req.raw.signal,
      );
      let content: string;
      try {
        content = await editSummary(summarizer.provider, {
          summary: current.content,
          instruction: body.data.instruction,
          earlier: recentInstructions(await loadEditLineage(deps.db, id)),
          transcript,
          confirmShrink: body.data.confirmShrink,
          signal: c.req.raw.signal,
        });
      } catch (error) {
        if (
          people.length > 0 &&
          error instanceof SummaryEditError &&
          error.reason === 'unchanged'
        ) {
          return c.json<SummaryAiEditDto>({ previousId: current.id, people }, 201);
        }
        if (error instanceof SummaryEditError && error.reason === 'unchanged') {
          throw new SummaryEditError(
            'unchanged',
            'The model made no changes, try rephrasing the instruction. Attendees and Unable to attend can be changed here too',
          );
        }
        throw error;
      }
      const latest = await findDoneSummary(deps.db, id);
      if (latest?.id !== current.id || (await hasPendingSummary(deps.db, id))) {
        return c.json({ error: 'The summary changed meanwhile, try again' }, 409);
      }
      const summaryId = await addSummaryVersion(deps.db, id, {
        origin: 'ai-edit',
        content,
        aiEdit: {
          provider: summarizer.id,
          model: summarizer.provider.model,
          instruction: body.data.instruction,
        },
      });
      return c.json<SummaryAiEditDto>({ summaryId, previousId: current.id, people }, 201);
    } catch (error) {
      if (error instanceof SummaryNotConfiguredError) {
        return c.json({ error: 'No summary provider is configured, see Settings' }, 400);
      }
      if (error instanceof SummaryEditError) {
        return c.json({ error: error.message, code: error.reason }, STATUS[error.reason]);
      }
      if (error instanceof ProviderError) {
        return c.json({ error: `The summary provider failed: ${error.message}` }, 502);
      }
      throw error;
    } finally {
      running.delete(id);
    }
  });

  return routes;
}
