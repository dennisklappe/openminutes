import type { SettingsStore } from '@openminutes/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SpeakerSettingsDto } from '../dto.js';

const input = z.object({ refine: z.boolean() });

export function speakerSettingsRoutes({ settings }: { settings: SettingsStore }): Hono {
  const routes = new Hono();

  const read = async (): Promise<SpeakerSettingsDto> => ({
    refine: (await settings.get('speakers.refine')) !== 'false',
  });

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid speaker settings' }, 400);
    await settings.set('speakers.refine', String(body.data.refine));
    return c.json(await read());
  });

  return routes;
}
