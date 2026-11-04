import type { SettingsStore } from '@openminutes/core';
import {
  fileNameProblem,
  folderTemplateProblem,
  GITHUB_DEFAULTS,
  GITHUB_VARIABLES,
} from '@openminutes/minutes';
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
  folderTemplate: z.string().trim().max(200),
  minutesFile: z.string().trim().max(100),
  transcriptFile: z.string().trim().max(100),
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
      folderTemplate: config?.folderTemplate ?? GITHUB_DEFAULTS.folderTemplate,
      minutesFile: config?.minutesFile ?? GITHUB_DEFAULTS.minutesFile,
      transcriptFile: config?.transcriptFile ?? GITHUB_DEFAULTS.transcriptFile,
      variables: [...GITHUB_VARIABLES],
      tokenSet: Boolean(config?.token),
    };
  };

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: body.error.issues[0]?.message ?? 'Invalid GitHub settings' }, 400);
    }
    const problem =
      folderTemplateProblem(body.data.folderTemplate) ??
      fileNameProblem(body.data.minutesFile) ??
      fileNameProblem(body.data.transcriptFile) ??
      (body.data.minutesFile === body.data.transcriptFile
        ? 'The two files need different names'
        : undefined);
    if (problem) return c.json({ error: problem }, 400);
    const saved = await readGithubConfig(settings);
    const token = body.data.token || saved?.token || '';
    if (!token) return c.json({ error: 'Add an access token' }, 400);
    await saveGithubConfig(settings, {
      token,
      repo: body.data.repo,
      branch: body.data.branch,
      folder: body.data.folder,
      includeTranscript: body.data.includeTranscript,
      folderTemplate: body.data.folderTemplate,
      minutesFile: body.data.minutesFile,
      transcriptFile: body.data.transcriptFile,
    });
    return c.json(await read());
  });

  routes.delete('/', async (c) => {
    await saveGithubConfig(settings, undefined);
    return c.json(await read());
  });

  return routes;
}
