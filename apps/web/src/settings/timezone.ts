import { isValidTimeZone, loadTimeZone, type SettingsStore } from '@openminutes/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { TimeZoneDto } from '../dto.js';

const input = z.object({
  timeZone: z.string().min(1).max(64),
  onlyIfUnset: z.boolean().optional(),
});

export function timeZoneRoutes({ settings }: { settings: SettingsStore }): Hono {
  const routes = new Hono();

  const read = async (): Promise<TimeZoneDto> => {
    const stored = await settings.get('instance.timezone');
    return {
      timeZone: isValidTimeZone(stored) ? stored : null,
      effective: await loadTimeZone(settings),
    };
  };

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success || !isValidTimeZone(body.data.timeZone)) {
      return c.json({ error: 'Pick a timezone such as Europe/Amsterdam' }, 400);
    }
    if (body.data.onlyIfUnset) await settings.setIfAbsent('instance.timezone', body.data.timeZone);
    else await settings.set('instance.timezone', body.data.timeZone);
    return c.json(await read());
  });

  return routes;
}
