import { rejoinSeries, type JobSender } from '@openminutes/core';
import { desc, skippedSeries, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SkippedSeriesDto } from '../dto.js';

export function seriesRoutes(deps: { db: Database; queue: JobSender }): Hono {
  const routes = new Hono();

  routes.get('/skipped', async (c) => {
    const rows = await deps.db.select().from(skippedSeries).orderBy(desc(skippedSeries.createdAt));
    return c.json<SkippedSeriesDto[]>(
      rows.map((row) => ({ id: row.id, title: row.title, since: row.createdAt.toISOString() })),
    );
  });

  routes.post('/skipped/:id/rejoin', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success || (await rejoinSeries(deps, id.data)) === 'not_found') {
      return c.json({ error: 'Series not found' }, 404);
    }
    return c.json({ ok: true });
  });

  return routes;
}
