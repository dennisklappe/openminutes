import { eq, meetings, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { MeetingDto } from '../dto.js';
import { toMeetingDto } from './meeting-dto.js';

const input = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((title) => !/\p{Cc}/u.test(title)),
});

export function titleRoutes({ db }: { db: Database }): Hono {
  const routes = new Hono();

  routes.patch('/:id', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Meeting not found' }, 404);
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(
        { error: 'The title must be 1 to 200 characters without control characters' },
        400,
      );
    }
    const [updated] = await db
      .update(meetings)
      .set({ title: body.data.title, titleEdited: true })
      .where(eq(meetings.id, id.data))
      .returning();
    if (!updated) return c.json({ error: 'Meeting not found' }, 404);
    return c.json<MeetingDto>(toMeetingDto(updated));
  });

  return routes;
}
