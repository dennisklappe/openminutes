import type { SettingsStore } from '@openminutes/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SummaryChatSettingsDto } from '../dto.js';

const input = z.object({ includeChat: z.boolean() });

export function summaryChatSettingsRoutes({ settings }: { settings: SettingsStore }): Hono {
  const routes = new Hono();

  const read = async (): Promise<SummaryChatSettingsDto> => ({
    includeChat: (await settings.get('summary.include_chat')) !== 'false',
  });

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid summary chat settings' }, 400);
    await settings.set('summary.include_chat', String(body.data.includeChat));
    return c.json(await read());
  });

  return routes;
}
