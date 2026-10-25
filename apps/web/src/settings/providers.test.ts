import { SettingsStore } from '@openminutes/core';
import { settings as settingsTable } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderTestDto, AiProviderSettingsDto } from '../dto.js';
import { providerSettingsRoutes } from './providers.js';

describe('transcription settings API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;
  let app: Hono;
  const requests: { url: string; headers: RequestInit['headers'] }[] = [];
  let reply = () => new Response('{"status":"ok"}');

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
    app = new Hono().route(
      '/transcription',
      providerSettingsRoutes('transcription', {
        settings: store,
        providerDeps: {
          fetch: (url, init) => {
            requests.push({ url, headers: init?.headers });
            return Promise.resolve(reply());
          },
        },
      }),
    );
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
  const read = async () =>
    (await send('GET', '/transcription')).json() as Promise<AiProviderSettingsDto>;

  it('lists the registry providers with their fields and defaults to local', async () => {
    const settings = await read();
    expect(settings.provider).toBe('local');
    expect(settings.providers.map((p) => p.id)).toEqual(
      expect.arrayContaining(['local', 'openai', 'groq', 'deepgram', 'assemblyai']),
    );
    const local = settings.providers.find((p) => p.id === 'local');
    expect(local?.fields).toContainEqual(
      expect.objectContaining({
        name: 'baseUrl',
        label: 'Service URL',
        type: 'string',
        required: false,
        secret: false,
        advanced: false,
        default: 'http://whisper:8000',
      }),
    );
    expect(local?.fields).toContainEqual(expect.objectContaining({ name: 'token', secret: true }));
    const deepgram = settings.providers.find((p) => p.id === 'deepgram');
    expect(deepgram?.fields).toContainEqual(
      expect.objectContaining({ name: 'diarize', type: 'boolean', default: true }),
    );
    expect(deepgram?.fields).toContainEqual(
      expect.objectContaining({ name: 'apiKey', required: true, secret: true }),
    );
  });

  it('describes fields with labels, help and an auto-detect language select', async () => {
    const { providers } = await read();
    for (const id of ['local', 'openai', 'groq', 'deepgram', 'assemblyai']) {
      const language = providers
        .find((p) => p.id === id)
        ?.fields.find((f) => f.name === 'language');
      expect(language?.label).toBe('Language');
      expect(language?.options?.[0]).toEqual({ value: '', label: 'Auto-detect (recommended)' });
      expect(language?.options).toContainEqual({ value: 'nl', label: 'Dutch (nl)' });
    }
    const openai = providers.find((p) => p.id === 'openai');
    expect(openai?.fields.map((f) => [f.name, f.label])).toEqual([
      ['apiKey', 'API key'],
      ['model', 'Model'],
      ['baseUrl', 'Base URL'],
      ['language', 'Language'],
    ]);
  });

  it('hides the base URL of hosted providers under advanced, not of local ones', async () => {
    const { providers } = await read();
    const baseUrl = (id: string) =>
      providers.find((p) => p.id === id)?.fields.find((f) => f.name === 'baseUrl');
    for (const id of ['openai', 'groq', 'deepgram', 'assemblyai']) {
      expect(baseUrl(id)?.advanced).toBe(true);
    }
    expect(baseUrl('local')?.advanced).toBe(false);
  });

  it('saves auto-detect as no language', async () => {
    const saved = await send('PUT', '/transcription', {
      provider: 'openai',
      config: { apiKey: 'sk-1', language: '' },
    });
    expect(saved.status).toBe(200);
    const openai = ((await saved.json()) as AiProviderSettingsDto).providers.find(
      (p) => p.id === 'openai',
    );
    expect(openai?.values).not.toHaveProperty('language');
  });

  it('rejects invalid config and unknown providers', async () => {
    const missingKey = await send('PUT', '/transcription', { provider: 'groq', config: {} });
    expect(missingKey.status).toBe(400);
    expect(((await missingKey.json()) as { error: string }).error).toContain('apiKey');
    expect((await send('PUT', '/transcription', { provider: 'nope', config: {} })).status).toBe(
      400,
    );
    expect((await send('PUT', '/transcription', { provider: 'groq' })).status).toBe(400);
  });

  it('stores config encrypted and never returns secrets', async () => {
    const response = await send('PUT', '/transcription', {
      provider: 'groq',
      config: { apiKey: 'gsk-secret-value', model: 'whisper-large-v3', language: '' },
    });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as AiProviderSettingsDto;
    expect(saved.provider).toBe('groq');
    const groq = saved.providers.find((p) => p.id === 'groq');
    expect(groq?.values).toEqual({ model: 'whisper-large-v3' });
    expect(groq?.secretsSet).toEqual(['apiKey']);
    expect(JSON.stringify(saved)).not.toContain('gsk-secret-value');

    const rows = await test.db.select().from(settingsTable);
    const stored = rows.find((r) => r.key === 'transcription.configs');
    expect(stored?.secret).toBe(true);
    expect(stored?.value).not.toContain('gsk-secret-value');
  });

  it('keeps a stored secret when the field is left blank', async () => {
    await send('PUT', '/transcription', {
      provider: 'groq',
      config: { apiKey: '', model: 'whisper-large-v3-turbo' },
    });
    const groq = (await read()).providers.find((p) => p.id === 'groq');
    expect(groq?.values).toEqual({ model: 'whisper-large-v3-turbo' });
    expect(groq?.secretsSet).toEqual(['apiKey']);

    requests.length = 0;
    await send('POST', '/transcription/test', { provider: 'groq', config: { apiKey: '' } });
    expect(JSON.stringify(requests[0]?.headers)).toContain('gsk-secret-value');
  });

  it('tests the unsaved form values and reports provider failures', async () => {
    requests.length = 0;
    const ok = await send('POST', '/transcription/test', {
      provider: 'local',
      config: { baseUrl: 'http://stub:9000', token: 'tkn' },
    });
    expect((await ok.json()) as ProviderTestDto).toEqual({ ok: true });
    expect(requests[0]?.url).toBe('http://stub:9000/health');
    expect((await read()).provider).toBe('groq');

    reply = () => new Response('nope', { status: 401 });
    const denied = (await (
      await send('POST', '/transcription/test', { provider: 'local', config: {} })
    ).json()) as ProviderTestDto;
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain('local');
  });
});
