import type { SettingsStore } from '@openminutes/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { UpdateChecker } from './checker.js';

interface UpdateRouteDeps {
  settings: SettingsStore;
  updates: UpdateChecker;
}

const toggle = z.object({ enabled: z.boolean() });
const dismissal = z.object({ version: z.string().min(1).max(64) });

export function updateRoutes({ settings, updates }: UpdateRouteDeps): Hono {
  const routes = new Hono();

  routes.get('/', async (c) => c.json(await updates.status()));

  routes.put('/', async (c) => {
    const body = toggle.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Send {"enabled": true|false}' }, 400);
    await settings.set('updates.enabled', String(body.data.enabled));
    return c.json(await updates.status());
  });

  routes.post('/dismiss', async (c) => {
    const body = dismissal.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Send {"version": "<version>"}' }, 400);
    await updates.dismiss(body.data.version);
    return c.json(await updates.status());
  });

  return routes;
}
