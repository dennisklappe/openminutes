import {
  createPrompt,
  deletePrompt,
  listPrompts,
  PromptNotFoundError,
  promptInputSchema,
  setDefaultPrompt,
  updatePrompt,
  type SettingsStore,
} from '@openminutes/core';
import { Hono } from 'hono';
import type { PromptsDto } from '../dto.js';

export function promptRoutes(deps: { settings: SettingsStore }): Hono {
  const routes = new Hono();

  routes.onError((error, c) => {
    if (error instanceof PromptNotFoundError) return c.json({ error: error.message }, 404);
    throw error;
  });

  const parseBody = async (request: Request) => {
    const body = promptInputSchema.safeParse(await request.json().catch(() => null));
    return body.success ? body.data : undefined;
  };
  const invalid = 'A name and prompt text are required';
  const all = (): Promise<PromptsDto> => listPrompts(deps.settings);

  routes.get('/', async (c) => c.json(await all()));

  routes.post('/', async (c) => {
    const body = await parseBody(c.req.raw);
    if (!body) return c.json({ error: invalid }, 400);
    await createPrompt(deps.settings, body);
    return c.json(await all(), 201);
  });

  routes.put('/:id', async (c) => {
    const body = await parseBody(c.req.raw);
    if (!body) return c.json({ error: invalid }, 400);
    await updatePrompt(deps.settings, c.req.param('id'), body);
    return c.json(await all());
  });

  routes.delete('/:id', async (c) => {
    await deletePrompt(deps.settings, c.req.param('id'));
    return c.json(await all());
  });

  routes.post('/:id/default', async (c) => {
    await setDefaultPrompt(deps.settings, c.req.param('id'));
    return c.json(await all());
  });

  return routes;
}
