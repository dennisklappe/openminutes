import { loadWizard, saveWizard, wizardSteps, type SettingsStore } from '@openminutes/core';
import { Hono } from 'hono';
import { z } from 'zod';

const input = z.object({
  step: z.enum(wizardSteps).optional(),
  completed: z.boolean().optional(),
});

export function wizardRoutes({ settings }: { settings: SettingsStore }): Hono {
  const routes = new Hono();

  routes.get('/', async (c) => c.json(await loadWizard(settings)));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Send {"step": ..., "completed": ...}' }, 400);
    return c.json(await saveWizard(settings, body.data));
  });

  return routes;
}
