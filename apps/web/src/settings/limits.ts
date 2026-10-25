import { MAX_CONCURRENT_MEETINGS, type SettingsStore } from '@openminutes/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { LimitsDto } from '../dto.js';

const input = z.object({
  lobbyTimeoutSeconds: z.int().min(30).max(3600),
  aloneTimeoutSeconds: z.int().min(10).max(3600),
  maxDurationMinutes: z.int().min(5).max(1440),
  maxConcurrent: z.int().min(1).max(MAX_CONCURRENT_MEETINGS),
});

export function limitsRoutes({ settings }: { settings: SettingsStore }): Hono {
  const routes = new Hono();

  const read = async (): Promise<LimitsDto> => ({
    lobbyTimeoutSeconds: await settings.getNumber('bot.lobby_timeout_seconds'),
    aloneTimeoutSeconds: await settings.getNumber('bot.alone_timeout_seconds'),
    maxDurationMinutes: await settings.getNumber('bot.max_duration_minutes'),
    maxConcurrent: await settings.getNumber('bot.max_concurrent'),
  });

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(
        { error: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        400,
      );
    }
    await settings.set('bot.lobby_timeout_seconds', String(body.data.lobbyTimeoutSeconds));
    await settings.set('bot.alone_timeout_seconds', String(body.data.aloneTimeoutSeconds));
    await settings.set('bot.max_duration_minutes', String(body.data.maxDurationMinutes));
    await settings.set('bot.max_concurrent', String(body.data.maxConcurrent));
    return c.json(await read());
  });

  return routes;
}
