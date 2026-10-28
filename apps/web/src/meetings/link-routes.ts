import type { Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { LinkableEventsDto, LinkEventInput } from '../dto.js';
import {
  DEFAULT_LINKABLE,
  LinkEventError,
  linkRecordingToEvent,
  listLinkableEvents,
  MAX_LINKABLE,
} from './link-event.js';

const DAY_MS = 86_400_000;
const MAX_SPAN_DAYS = 400;

const windowQuery = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    limit: z.coerce.number().int().min(1).max(MAX_LINKABLE).default(DEFAULT_LINKABLE),
  })
  .refine(({ from, to }) => {
    const span = new Date(to).getTime() - new Date(from).getTime();
    return span >= 0 && span <= MAX_SPAN_DAYS * DAY_MS;
  });
const linkInput = z.object({ eventId: z.uuid() }) satisfies z.ZodType<LinkEventInput>;
const uuid = z.uuid();

/**
 * Linking a recording to a calendar meeting. Mounted before the meeting routes so
 * `/linkable-events` is not read as a meeting id.
 */
export function linkEventRoutes(deps: { db: Database }): Hono {
  const routes = new Hono();

  routes.get('/linkable-events', async (c) => {
    const query = windowQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: 'Invalid time window' }, 400);
    const { from, to, limit } = query.data;
    return c.json<LinkableEventsDto>({
      items: await listLinkableEvents(deps.db, new Date(from), new Date(to), limit),
    });
  });

  routes.post('/:id/link-event', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    const body = linkInput.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success) return c.json({ error: 'Invalid calendar meeting' }, 400);
    try {
      await linkRecordingToEvent(deps.db, id.data, body.data.eventId);
    } catch (error) {
      if (error instanceof LinkEventError) return c.json({ error: error.message }, error.status);
      throw error;
    }
    return c.json({ ok: true });
  });

  return routes;
}
