import { createProviders } from '@openminutes/calendar';
import { LocalStorage, sanitizeSummaryMarkdown, SettingsStore } from '@openminutes/core';
import { eq, meetings, summaries } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { AccessVerifier } from '../auth/access.js';
import { makeKey, signToken, startFakeJwks, type FakeJwks } from '../auth/access-fixtures.js';
import type { MeetingDetailDto } from '../dto.js';
import { createShareLink } from './share-routes.js';

const secret = 'a-long-enough-test-secret';
const AI = '### Decisions\n\n- Ship it';

describe('editable summaries', () => {
  const key = makeKey('key-1');
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let jwks: FakeJwks;
  let app: Hono;
  let meetingId = '';
  let summaryId = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    jwks = await startFakeJwks([key]);
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-edit-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      access: new AccessVerifier(jwks.config),
      publicUrl: 'https://minutes.example/',
    });
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Edit me',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'transcribed',
      })
      .returning();
    if (!meeting) throw new Error('no meeting');
    meetingId = meeting.id;
    const [summary] = await test.db
      .insert(summaries)
      .values({ meetingId, provider: 'fake', model: 'm', status: 'done', content: AI })
      .returning();
    if (!summary) throw new Error('no summary');
    summaryId = summary.id;
  });
  afterAll(async () => {
    await jwks.close();
    await test.close();
  });

  const auth = () => ({ 'cf-access-jwt-assertion': signToken(key), origin: 'http://localhost' });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { ...auth(), ...(body !== undefined && { 'content-type': 'application/json' }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const editPath = () => `/api/meetings/${meetingId}/summaries/edit`;
  const restorePath = (id: string) => `/api/meetings/${meetingId}/summaries/${id}/restore`;
  const detail = async () =>
    (await (await call('GET', `/api/meetings/${meetingId}`)).json()) as MeetingDetailDto;
  const active = async () => {
    const found = (await detail()).summaries.find((summary) => summary.active);
    if (!found) throw new Error('no active summary');
    return found;
  };
  const count = async () => (await detail()).summaries.length;
  const link = async () => {
    const row = await createShareLink(test.db, meetingId, {
      includeTranscript: false,
      expiresInDays: null,
    });
    return { url: `https://minutes.example/s/${row.token}` };
  };
  const tokenPath = (url: string) => new URL(url).pathname;

  it('saves an edit as a new active version and keeps the AI version', async () => {
    expect((await call('POST', editPath(), { content: '- Edited <b>item</b>' })).status).toBe(201);
    const { summaries: all } = await detail();
    expect(all.map((s) => [s.version, s.author, s.active])).toEqual([
      [2, 'edited by you', true],
      [1, 'AI (m)', false],
    ]);
    expect(all[0]?.content).toBe('- Edited item');
    expect(all[1]?.content).toBe(AI);
  });

  it('restores an older version as a new active version and keeps every other one', async () => {
    expect((await call('POST', restorePath(summaryId))).status).toBe(201);
    const { summaries: all } = await detail();
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({
      version: 3,
      active: true,
      content: AI,
      author: 'restored from version 1',
      restoredFromVersion: 1,
    });
    const edited = all[1];
    expect(edited?.content).toBe('- Edited item');
    expect((await call('POST', restorePath(edited?.id ?? ''))).status).toBe(201);
    expect(await active()).toMatchObject({
      version: 4,
      content: '- Edited item',
      author: 'restored from version 2',
    });
  });

  it('rejects empty, oversized and unknown edits and restores', async () => {
    expect((await call('POST', editPath(), { content: '' })).status).toBe(400);
    expect((await call('POST', editPath(), { content: 'x'.repeat(50_001) })).status).toBe(400);
    expect((await call('POST', restorePath(crypto.randomUUID()))).status).toBe(404);
    expect((await call('POST', restorePath('nope'))).status).toBe(404);
  });

  it('refuses edits and restores while a summary is being generated', async () => {
    const before = await count();
    const [pending] = await test.db
      .insert(summaries)
      .values({ meetingId, provider: 'fake', model: 'm' })
      .returning();
    expect((await call('POST', editPath(), { content: '- x' })).status).toBe(409);
    expect((await call('POST', restorePath(summaryId))).status).toBe(409);
    await test.db.delete(summaries).where(eq(summaries.id, pending?.id ?? ''));
    expect(await count()).toBe(before);
  });

  it('keeps the previous versions when a new AI version is generated', async () => {
    const before = await count();
    const [fresh] = await test.db
      .insert(summaries)
      .values({ meetingId, provider: 'fake', model: 'm2', status: 'done', content: '- New AI' })
      .returning();
    const all = (await detail()).summaries;
    expect(all).toHaveLength(before + 1);
    expect(all[0]).toMatchObject({ id: fresh?.id, active: true, author: 'AI (m2)' });
    expect(all.filter((s) => s.active)).toHaveLength(1);
    await call('POST', restorePath(summaryId));
  });

  it('renders the latest edit in the shared minutes and the markdown export', async () => {
    await call('POST', editPath(), { content: '- Latest wording' });
    const view = await link();
    const html = await (await app.request(tokenPath(view.url))).text();
    expect(html).toContain('Latest wording');
    expect(html).not.toContain('Ship it');
    await call('POST', restorePath(summaryId));
  });

  describe('share links are read-only', () => {
    it('has no edit link API and refuses writes to a share page', async () => {
      expect(
        (await call('POST', `/api/meetings/${meetingId}/shares`, { mode: 'edit' })).status,
      ).toBe(404);
      const view = await link();
      const before = await count();
      const response = await app.request(tokenPath(view.url), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ summary: summaryId, content: '- hacked' }),
      });
      expect(response.status).toBe(404);
      expect(await count()).toBe(before);
      const page = await app.request(tokenPath(view.url));
      expect(await page.text()).not.toContain('<textarea');
      expect(page.headers.get('content-security-policy')).toContain("form-action 'none'");
    });
  });

  describe('sanitiser', () => {
    it('strips tags, control characters and dashes', () => {
      expect(sanitizeSummaryMarkdown('a <img src=x onerror=y> b\u0000 \u2014 c')).toBe('a  b, c');
    });
  });
});
