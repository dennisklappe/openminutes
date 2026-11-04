import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders, endpointsFor } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { meetings, summaries, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { GithubSettingsDto, MeetingExportDto } from '../dto.js';
import { runAutoExport } from './auto-export.js';
import { createWebExporters } from './exporters.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('exporting to a GitHub repository', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let settings: SettingsStore;
  let storage: LocalStorage;
  let session = '';
  let meetingId = '';
  const calls: { method: string; url: string; body: unknown }[] = [];
  const sent: string[] = [];

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, secret);
    storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-gh-')));
    const queue = {
      send: (name: string) => {
        sent.push(name);
        return Promise.resolve();
      },
    };
    const providers = createProviders({});
    const reply = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
    const exporters = createWebExporters({
      calendar: { db: test.db, queue, settings, providers, secret },
      endpoints: endpointsFor(),
      publicUrl: 'https://openminutes.test',
      githubApi: 'https://github.test',
      fetch: (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const raw = init?.body;
        calls.push({
          method: init?.method ?? 'GET',
          url,
          body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw,
        });
        if (url.endsWith('/repos/acme/kb')) return reply({ default_branch: 'main' });
        if (url.includes('/git/ref/')) return reply({ object: { sha: 'c0' } });
        if (url.endsWith('/git/commits/c0')) return reply({ tree: { sha: 't0' } });
        if (url.endsWith('/git/trees')) return reply({ sha: 't1' });
        if (url.endsWith('/git/commits')) return reply({ sha: 'c1' });
        return reply({});
      },
    });
    app = createApp({
      db: test.db,
      settings,
      storage,
      secret,
      calendarProviders: providers,
      exporters,
      publicUrl: 'https://openminutes.test',
      version: '1.2.3',
      queue,
    });
    const created = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    session = created.headers.get('set-cookie')?.split(';')[0] ?? '';
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Roadmap review',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'transcribed',
        startedAt: new Date('2026-03-12T09:30:00Z'),
        endedAt: new Date('2026-03-12T10:00:00Z'),
      })
      .returning();
    if (!meeting) throw new Error('no meeting');
    meetingId = meeting.id;
    await test.db.insert(transcriptSegments).values({
      meetingId,
      participantId: null,
      startMs: 1000,
      endMs: 2000,
      text: 'The transcript sentence.',
    });
    await test.db.insert(summaries).values({
      meetingId,
      provider: 'fake',
      model: 'm',
      status: 'done',
      content: '### Decisions\n\n- Ship it',
    });
  });

  afterAll(async () => {
    await test.close();
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { ...json, cookie: session },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const read = async <T>(response: Response) => (await response.json()) as T;
  const github = {
    repo: 'acme/kb',
    branch: '',
    folder: 'meetings',
    includeTranscript: true,
    folderTemplate: '{yyyy}-{MM}-{dd} {title}',
    minutesFile: 'MINUTES.md',
    transcriptFile: 'TRANSCRIPT.md',
    token: 'github_pat_secret',
  };

  it('is not available until a repository and token are saved', async () => {
    const destinations = await read<{ id: string; available: boolean }[]>(
      await send('GET', '/api/settings/minutes'),
    ).then(
      (s) => (s as unknown as { destinations: { id: string; available: boolean }[] }).destinations,
    );
    expect(destinations.find((d) => d.id === 'github')?.available).toBe(false);
    const refused = await send('POST', `/api/meetings/${meetingId}/export/github`, {});
    expect(refused.status).toBe(422);
    expect(
      (await send('PUT', '/api/settings/minutes/github', { ...github, token: '' })).status,
    ).toBe(400);
    expect(
      (await send('PUT', '/api/settings/minutes/github', { ...github, repo: 'nope' })).status,
    ).toBe(400);
  });

  it('rejects a bad folder template or file name', async () => {
    for (const bad of [
      { folderTemplate: '{nope} {title}' },
      { minutesFile: 'a/b.md' },
      { transcriptFile: 'MINUTES.md' },
    ]) {
      expect(
        (await send('PUT', '/api/settings/minutes/github', { ...github, ...bad })).status,
      ).toBe(400);
    }
  });

  it('saves the settings without ever returning the token', async () => {
    const saved = await send('PUT', '/api/settings/minutes/github', github);
    const text = await saved.text();
    expect(text).not.toContain('github_pat_secret');
    expect(JSON.parse(text)).toMatchObject({ repo: 'acme/kb', folder: 'meetings', tokenSet: true });
    // Saving again without a token keeps the stored one.
    const again = await send('PUT', '/api/settings/minutes/github', { ...github, token: '' });
    expect((await read<GithubSettingsDto>(again)).tokenSet).toBe(true);
  });

  it('commits the minutes and transcript and records the folder', async () => {
    calls.length = 0;
    const response = await send('POST', `/api/meetings/${meetingId}/export/github`, {});
    expect(response.status).toBe(200);
    const outcome = await read<{ kind: string; url: string; ref: string }>(response);
    expect(outcome.kind).toBe('link');
    expect(outcome.ref).toMatch(/^meetings\/2026-03-12 Roadmap review$/);
    const tree = calls.find((c) => c.url.endsWith('/git/trees'));
    const paths = (tree?.body as { tree: { path: string; content: string }[] }).tree;
    expect(paths.map((p) => p.path.split('/').pop())).toEqual(['MINUTES.md', 'TRANSCRIPT.md']);
    expect(paths[0]?.content).toContain('Ship it');
    expect(paths[1]?.content).toContain('The transcript sentence.');
    const records = await read<MeetingExportDto[]>(
      await send('GET', `/api/meetings/${meetingId}/exports`),
    );
    expect(records).toMatchObject([{ exporterId: 'github', ref: outcome.ref }]);
  });

  it('updates the same folder and runs automatically when it is the target', async () => {
    const [first] = await read<MeetingExportDto[]>(
      await send('GET', `/api/meetings/${meetingId}/exports`),
    );
    await send('PUT', '/api/settings/minutes/export', {
      target: 'github',
      googleAccountId: null,
      microsoftAccountId: null,
      ownerEmail: '',
      auto: true,
      calendarLink: false,
    });
    calls.length = 0;
    await runAutoExport(
      {
        db: test.db,
        settings,
        storage,
        exporters: createWebExporters({
          calendar: {
            db: test.db,
            queue: { send: () => Promise.resolve() },
            settings,
            providers: createProviders({}),
            secret,
          },
          endpoints: endpointsFor(),
          publicUrl: undefined,
          githubApi: 'https://github.test',
          fetch: (input) => {
            const url =
              typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            const body = url.includes('/git/ref/')
              ? { object: { sha: 'c0' } }
              : url.endsWith('/git/commits/c0')
                ? { tree: { sha: 't0' } }
                : { sha: 'x', default_branch: 'main' };
            calls.push({ method: 'x', url, body: undefined });
            return Promise.resolve(new Response(JSON.stringify(body)));
          },
        }),
        publicUrl: undefined,
      },
      meetingId,
    );
    expect(calls.some((c) => c.url.endsWith('/git/trees'))).toBe(true);
    const [after] = await read<MeetingExportDto[]>(
      await send('GET', `/api/meetings/${meetingId}/exports`),
    );
    expect(after?.ref).toBe(first?.ref);
  });

  it('queues a new commit when the title or summary is edited, only with automatic GitHub export', async () => {
    sent.length = 0;
    expect((await send('PATCH', `/api/meetings/${meetingId}`, { title: 'Renamed' })).status).toBe(
      200,
    );
    expect(sent).toEqual(['meeting.export']);
    // A failed edit queues nothing.
    sent.length = 0;
    await send('PATCH', `/api/meetings/${meetingId}`, { title: '' });
    expect(sent).toEqual([]);
    // Nothing is queued once the automatic export is off.
    await send('PUT', '/api/settings/minutes/export', {
      target: 'github',
      googleAccountId: null,
      microsoftAccountId: null,
      ownerEmail: '',
      auto: false,
      calendarLink: false,
    });
    await send('PATCH', `/api/meetings/${meetingId}`, { title: 'Renamed again' });
    expect(sent).toEqual([]);
  });
});
