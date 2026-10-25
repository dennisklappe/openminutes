import { SettingsStore } from '@openminutes/core';
import { settings as settingsTable } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiProviderSettingsDto, ProviderTestDto, PromptsDto } from '../dto.js';
import { promptRoutes } from './prompts.js';
import { providerSettingsRoutes } from './providers.js';
import { speakerSettingsRoutes } from './speakers.js';
import { summaryChatSettingsRoutes } from './summary-chat.js';

describe('summary settings API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  const requests: { url: string; headers: RequestInit['headers'] }[] = [];

  beforeAll(async () => {
    test = await createTestDatabase();
    const settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
    app = new Hono()
      .route(
        '/summary',
        providerSettingsRoutes('summary', {
          settings,
          providerDeps: {
            fetch: (url, init) => {
              requests.push({ url, headers: init?.headers });
              return Promise.resolve(new Response('{"data":[]}'));
            },
          },
        }),
      )
      .route('/prompts', promptRoutes({ settings }))
      .route('/speakers', speakerSettingsRoutes({ settings }))
      .route('/summary-chat', summaryChatSettingsRoutes({ settings }));
  });
  afterAll(() => test.close());

  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });

  it('defaults to no summaries and lists the three providers', async () => {
    const settings = (await (await send('GET', '/summary')).json()) as AiProviderSettingsDto;
    expect(settings.provider).toBe('none');
    expect(settings.providers.map((p) => p.id)).toEqual(['none', 'openai-compatible', 'anthropic']);
    const openai = settings.providers.find((p) => p.id === 'openai-compatible');
    expect(openai?.fields.map((f) => f.name)).toEqual([
      'baseUrl',
      'model',
      'apiKey',
      'temperature',
      'maxInputChars',
    ]);
  });

  it('stores the key encrypted and never returns it', async () => {
    const saved = await send('PUT', '/summary', {
      provider: 'openai-compatible',
      config: { baseUrl: 'http://llm/v1', model: 'm', apiKey: 'sk-very-secret' },
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as AiProviderSettingsDto;
    expect(body.provider).toBe('openai-compatible');
    expect(body.providers.find((p) => p.id === 'openai-compatible')?.secretsSet).toEqual([
      'apiKey',
    ]);
    expect(JSON.stringify(body)).not.toContain('sk-very-secret');
    const rows = await test.db.select().from(settingsTable);
    expect(rows.find((r) => r.key === 'summary.configs')).toMatchObject({ secret: true });
    expect(rows.find((r) => r.key === 'summary.configs')?.value).not.toContain('sk-very-secret');
  });

  it('rejects incomplete config and tests with the stored key', async () => {
    expect((await send('PUT', '/summary', { provider: 'anthropic', config: {} })).status).toBe(400);
    const result = (await (
      await send('POST', '/summary/test', {
        provider: 'openai-compatible',
        config: { baseUrl: 'http://llm/v1', model: 'm', apiKey: '' },
      })
    ).json()) as ProviderTestDto;
    expect(result.ok).toBe(true);
    expect(requests.at(-1)?.url).toBe('http://llm/v1/models');
    expect(JSON.stringify(requests.at(-1)?.headers)).toContain('sk-very-secret');
  });

  it('manages prompt templates and the default', async () => {
    const created = await send('POST', '/prompts', { name: 'Standup', content: 'Blockers.' });
    expect(created.status).toBe(201);
    const { prompts } = (await created.json()) as PromptsDto;
    const custom = prompts.find((p) => !p.builtin);
    expect(prompts[0]).toMatchObject({ id: 'default', builtin: true });
    if (!custom) throw new Error('prompt missing');

    const edited = (await (
      await send('PUT', `/prompts/${custom.id}`, { name: 'Standup 2', content: 'Blockers only.' })
    ).json()) as PromptsDto;
    expect(edited.prompts.find((p) => p.id === custom.id)?.name).toBe('Standup 2');

    const made = (await (await send('POST', `/prompts/${custom.id}/default`)).json()) as PromptsDto;
    expect(made.defaultId).toBe(custom.id);

    const removed = (await (await send('DELETE', `/prompts/${custom.id}`)).json()) as PromptsDto;
    expect(removed).toMatchObject({ defaultId: 'default', prompts: [{ id: 'default' }] });
  });

  it('validates prompt input and unknown ids', async () => {
    expect((await send('POST', '/prompts', { name: '', content: 'x' })).status).toBe(400);
    expect((await send('PUT', '/prompts/default', { name: 'x', content: 'y' })).status).toBe(404);
    expect((await send('DELETE', '/prompts/default')).status).toBe(404);
    expect((await send('POST', '/prompts/nope/default')).status).toBe(404);
  });

  it('gives the summary the chat until it is switched off', async () => {
    expect(await (await send('GET', '/summary-chat')).json()).toEqual({ includeChat: true });
    const saved = await send('PUT', '/summary-chat', { includeChat: false });
    expect(await saved.json()).toEqual({ includeChat: false });
    expect(await (await send('GET', '/summary-chat')).json()).toEqual({ includeChat: false });
    expect((await send('PUT', '/summary-chat', { includeChat: 'no' })).status).toBe(400);
  });

  it('has speaker refinement on until it is switched off', async () => {
    expect(await (await send('GET', '/speakers')).json()).toEqual({ refine: true });
    const saved = await send('PUT', '/speakers', { refine: false });
    expect(await saved.json()).toEqual({ refine: false });
    expect(await (await send('GET', '/speakers')).json()).toEqual({ refine: false });
    expect((await send('PUT', '/speakers', { refine: 'yes' })).status).toBe(400);
  });
});
