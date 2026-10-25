import { eq, participantAliases, sql, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ParticipantAliasesDto } from '../dto.js';

const uuid = z.uuid();
const input = z.object({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((name) => !/\p{Cc}/u.test(name)),
});

export function participantAliasRoutes({ db }: { db: Database }): Hono {
  const routes = new Hono();

  const read = async (): Promise<ParticipantAliasesDto> => ({
    aliases: await db
      .select({
        id: participantAliases.id,
        originalName: participantAliases.originalName,
        displayName: participantAliases.displayName,
      })
      .from(participantAliases)
      .orderBy(sql`lower(${participantAliases.originalName})`),
  });

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/:id', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!id.success) return c.json({ error: 'Name not found' }, 404);
    if (!body.success) return c.json({ error: 'The name must be 1 to 80 characters' }, 400);
    const updated = await db
      .update(participantAliases)
      .set({ displayName: body.data.displayName })
      .where(eq(participantAliases.id, id.data))
      .returning({ id: participantAliases.id });
    if (updated.length === 0) return c.json({ error: 'Name not found' }, 404);
    return c.json(await read());
  });

  routes.delete('/:id', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Name not found' }, 404);
    const removed = await db
      .delete(participantAliases)
      .where(eq(participantAliases.id, id.data))
      .returning({ id: participantAliases.id });
    if (removed.length === 0) return c.json({ error: 'Name not found' }, 404);
    return c.json(await read());
  });

  return routes;
}
