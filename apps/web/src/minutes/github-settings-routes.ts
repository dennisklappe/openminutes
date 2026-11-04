import type { SettingsStore } from '@openminutes/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { GithubSettingsDto } from '../dto.js';
import { readGithubConfig, saveGithubConfig } from './github-settings.js';

const input = z.object({
  repo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Use owner/name'),
  branch: z
    .string()
    .trim()
    .max(200)
    .regex(/^[^\s~^:?*[\\]*$/, 'Not a branch name')
    .refine((name) => !/\.\.|@\{|\/\/|^[/.]|[/.]$|\.lock(\/|$)/.test(name), 'Not a branch name'),
  folder: z.string().trim().max(200),
  includeTranscript: z.boolean(),
  /** Empty keeps the saved token. */
  token: z.string().trim().max(500).optional(),
});

export function githubSettingsRoutes({ settings }: { settings: SettingsStore }): Hono {
  const routes = new Hono();

  const read = async (): Promise<GithubSettingsDto> => {
    const config = await readGithubConfig(settings);
    return {
      repo: config?.repo ?? '',
      branch: config?.branch ?? '',
      folder: config?.folder ?? '',
      includeTranscript: config?.includeTranscript ?? true,
      tokenSet: Boolean(config?.token),
    };
  };

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: body.error.issues[0]?.message ?? 'Invalid GitHub settings' }, 400);
    }
    const saved = await readGithubConfig(settings);
    const token = body.data.token || saved?.token || '';
    if (!token) return c.json({ error: 'Add an access token' }, 400);
    await saveGithubConfig(settings, {
      token,
      repo: body.data.repo,
      branch: body.data.branch,
      folder: body.data.folder,
      includeTranscript: body.data.includeTranscript,
    });
    return c.json(await read());
  });

  routes.delete('/', async (c) => {
    await saveGithubConfig(settings, undefined);
    return c.json(await read());
  });

  return routes;
}
