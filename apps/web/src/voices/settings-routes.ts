import { eq, knownVoices } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { VoiceSettingsDto } from '../dto.js';
import { rememberEnabled, type VoiceDeps } from './load.js';

const input = z.object({ remember: z.boolean() });

export function voiceSettingsRoutes({ db, settings }: VoiceDeps): Hono {
  const routes = new Hono();

  const read = async (): Promise<VoiceSettingsDto> => ({
    remember: await rememberEnabled(settings),
    known: (
      await db
        .select({
          id: knownVoices.id,
          name: knownVoices.name,
          samples: knownVoices.samples,
          updatedAt: knownVoices.updatedAt,
        })
        .from(knownVoices)
        .orderBy(knownVoices.name)
    ).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
  });

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid voice settings' }, 400);
    await settings.set('voices.remember', String(body.data.remember));
    return c.json(await read());
  });

  routes.delete('/:id', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Voice not found' }, 404);
    const removed = await db.delete(knownVoices).where(eq(knownVoices.id, id.data)).returning();
    if (removed.length === 0) return c.json({ error: 'Voice not found' }, 404);
    return c.json(await read());
  });

  routes.delete('/', async (c) => {
    await db.delete(knownVoices);
    return c.json(await read());
  });

  return routes;
}
