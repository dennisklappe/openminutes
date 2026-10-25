import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders, endpointsFor } from '@openminutes/calendar';
import { startFakeCalendar, type FakeCalendar } from '@openminutes/calendar/fake';
import { LocalStorage, SettingsStore, type JobName, type JobPayloads } from '@openminutes/core';
import { meetings, participants, summaries, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { AccountsDto, ExportSettingsDto, MeetingExportDto } from '../dto.js';
import { createWebExporters } from './exporters.js';
import { runAutoExport } from './auto-export.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('exporting to Google Docs against a fake Google API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let fake: FakeCalendar;
  let app: Hono;
  let session = '';
  let meetingId = '';
  let accountId = '';
  const sent: { name: JobName; payload: JobPayloads[JobName] }[] = [];

  beforeAll(async () => {
    test = await createTestDatabase();
    fake = await startFakeCalendar({ email: 'openminutes.bot@example.com' });
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-docs-'))),
      secret,
      calendarProviders: createProviders({ fakeBaseUrl: fake.baseUrl }),
      endpoints: endpointsFor(fake.baseUrl),
      publicUrl: 'https://openminutes.test',
      version: '1.2.3',
      queue: {
        send: (name, payload) => {
          sent.push({ name, payload });
          return Promise.resolve();
        },
      },
    });
    const created = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    session = created.headers.get('set-cookie')?.split(';')[0] ?? '';
    await send('PUT', '/api/accounts/providers/google', { clientId: 'id', clientSecret: 's' });

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
    const [anna] = await test.db
      .insert(participants)
      .values({ meetingId, displayName: 'Anna de Vries' })
      .returning();
    await test.db.insert(transcriptSegments).values({
      meetingId,
      participantId: anna?.id ?? null,
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
    await fake.close();
    await test.close();
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { ...json, cookie: session },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const read = async <T>(response: Response) => (await response.json()) as T;

  async function connect(exportAccess: boolean): Promise<void> {
    const start = await send('GET', `/api/oauth/google/start${exportAccess ? '?export=1' : ''}`);
    const oauthCookie = start.headers.get('set-cookie')?.split(';')[0] ?? '';
    const authorizeUrl = new URL(start.headers.get('location') ?? '');
    expect(authorizeUrl.searchParams.get('scope')?.includes('drive.file')).toBe(exportAccess);
    const consent = await fetch(authorizeUrl, { redirect: 'manual' });
    const callback = new URL(consent.headers.get('location') ?? '');
    await app.request(`/api/oauth/google/callback${callback.search}`, {
      headers: { cookie: oauthCookie },
    });
  }

  it('refuses until the account has allowed document export', async () => {
    await connect(false);
    const accounts = await read<AccountsDto>(await send('GET', '/api/accounts'));
    expect(accounts.accounts[0]).toMatchObject({
      email: 'openminutes.bot@example.com',
      canExport: false,
    });
    accountId = accounts.accounts[0]?.id ?? '';
    await send('PUT', '/api/settings/minutes/export', {
      target: 'google-docs',
      googleAccountId: accountId,
      microsoftAccountId: null,
      ownerEmail: 'owner@example.com',
      auto: true,
    });
    const refused = await send('POST', `/api/meetings/${meetingId}/export/google-docs`, {});
    expect(refused.status).toBe(422);
    expect((await read<{ error: string }>(refused)).error).toContain(
      'has not allowed document export',
    );
  });

  it('creates a doc owned by the bot, shared only with the owner, and records it', async () => {
    await connect(true);
    const settings = await read<ExportSettingsDto>(
      await send('GET', '/api/settings/minutes/export'),
    );
    expect(settings.accounts[0]?.canExport).toBe(true);
    expect(settings.targets.find((t) => t.id === 'google-docs')).toMatchObject({ automatic: true });

    const response = await send('POST', `/api/meetings/${meetingId}/export/google-docs`, {
      includeTranscript: true,
    });
    expect(response.status).toBe(200);
    const outcome = await read<{ kind: string; url: string }>(response);
    expect(outcome.kind).toBe('link');
    const [doc] = [...fake.documents.documents.values()];
    expect(outcome.url).toBe(`https://docs.google.com/document/d/${doc?.id}/edit`);
    expect(doc?.title).toBe('Roadmap review');
    expect(doc?.tabs.map((tab) => tab.title)).toEqual(['Minutes', 'Transcript']);
    expect(doc?.tabs[0]?.text).toContain('Roadmap review\nDate: Thursday, 12 March 2026');
    expect(doc?.tabs[0]?.text).toContain('Ship it');
    expect(doc?.tabs[1]?.text).toContain('Anna de Vries: The transcript sentence.');
    expect(doc?.permissions).toEqual([
      expect.objectContaining({
        role: 'writer',
        emailAddress: 'owner@example.com',
        query: '?sendNotificationEmail=false',
      }),
    ]);

    const records = await read<MeetingExportDto[]>(
      await send('GET', `/api/meetings/${meetingId}/exports`),
    );
    expect(records).toEqual([
      expect.objectContaining({ exporterId: 'google-docs', url: outcome.url }),
    ]);
  });

  it('updates the same doc by default and creates a new one on request', async () => {
    await send('POST', `/api/meetings/${meetingId}/export/google-docs`, {
      includeTranscript: true,
    });
    expect(fake.documents.documents.size).toBe(1);
    const [doc] = [...fake.documents.documents.values()];
    expect(doc?.tabs[0]?.text.match(/Roadmap review/g)).toHaveLength(1);
    expect(doc?.permissions).toHaveLength(1);

    await send('POST', `/api/meetings/${meetingId}/export/google-docs`, { mode: 'new' });
    expect(fake.documents.documents.size).toBe(2);
    const records = await read<MeetingExportDto[]>(
      await send('GET', `/api/meetings/${meetingId}/exports`),
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.url).toContain([...fake.documents.documents.keys()][1]);
  });

  it('exports automatically from the queued job only when switched on', async () => {
    const deps = {
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-auto-'))),
      publicUrl: undefined,
      exporters: createWebExporters({
        calendar: {
          db: test.db,
          queue: { send: () => Promise.resolve() },
          settings: new SettingsStore(test.db, secret),
          providers: createProviders({ fakeBaseUrl: fake.baseUrl }),
          secret,
        },
        endpoints: endpointsFor(fake.baseUrl),
        publicUrl: undefined,
      }),
    };
    const before = fake.documents.documents.size;
    await send('PUT', '/api/settings/minutes/export', {
      target: 'google-docs',
      googleAccountId: accountId,
      microsoftAccountId: null,
      ownerEmail: 'owner@example.com',
      auto: false,
    });
    await runAutoExport(deps, meetingId);
    expect(fake.documents.documents.size).toBe(before);

    await send('PUT', '/api/settings/minutes/export', {
      target: 'google-docs',
      googleAccountId: accountId,
      microsoftAccountId: null,
      ownerEmail: 'owner@example.com',
      auto: true,
    });
    await send('PUT', '/api/settings/minutes', {
      template: 'classic',
      includeTranscript: true,
      transcriptPlacement: 'inline',
    });
    await runAutoExport(deps, meetingId);
    expect(fake.documents.documents.size).toBe(before);
    const [first] = [...fake.documents.documents.values()].slice(1);
    expect(first?.tabs).toHaveLength(1);
  });
});
