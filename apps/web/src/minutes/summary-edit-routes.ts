import { MAX_SUMMARY_CHARS } from '@openminutes/core';
import type { Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { addSummaryVersion, findDoneSummary, hasPendingSummary } from './summary-edit.js';

const uuid = z.uuid();
const edit = z.object({ content: z.string().min(1).max(MAX_SUMMARY_CHARS) });
const PENDING = 'A summary is being generated, wait for it to finish';

export function summaryEditRoutes(deps: { db: Database }): Hono {
  const routes = new Hono();

  routes.post('/:id/summaries/edit', async (c) => {
    const meetingId = uuid.safeParse(c.req.param('id'));
    if (!meetingId.success) return c.json({ error: 'Summary not found' }, 404);
    if (!(await findDoneSummary(deps.db, meetingId.data))) {
      return c.json({ error: 'Summary not found' }, 404);
    }
    const body = edit.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'The summary must be 1 to 50000 characters' }, 400);
    if (await hasPendingSummary(deps.db, meetingId.data)) return c.json({ error: PENDING }, 409);
    await addSummaryVersion(deps.db, meetingId.data, {
      origin: 'edit',
      content: body.data.content,
    });
    return c.json({ ok: true }, 201);
  });

  routes.post('/:id/summaries/:summaryId/restore', async (c) => {
    const meetingId = uuid.safeParse(c.req.param('id'));
    const summaryId = uuid.safeParse(c.req.param('summaryId'));
    const version =
      meetingId.success && summaryId.success
        ? await findDoneSummary(deps.db, meetingId.data, summaryId.data)
        : undefined;
    if (!meetingId.success || !version) return c.json({ error: 'Summary not found' }, 404);
    if (await hasPendingSummary(deps.db, meetingId.data)) return c.json({ error: PENDING }, 409);
    await addSummaryVersion(deps.db, meetingId.data, {
      origin: 'restore',
      content: version.content,
      restoredFrom: version.id,
    });
    return c.json({ ok: true }, 201);
  });

  return routes;
}
