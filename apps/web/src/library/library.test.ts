import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { eq, meetings, participants, summaries, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { FolderDto, LibraryDto, MeetingDetailDto } from '../dto.js';
import { summarySnippet } from './snippet.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const missing = '00000000-0000-4000-8000-000000000000';

describe('summarySnippet', () => {
  it('drops headings and formatting and keeps the first words', () => {
    const text = '## Decisions\n\n- **Ship** on [Monday](https://x.test)\n- Audio: 30 days\n';
    expect(summarySnippet(text)).toBe('Ship on Monday Audio: 30 days');
  });

  it('cuts long text at a word with an ellipsis', () => {
    const snippet = summarySnippet(`${'word '.repeat(80)}end`);
    expect(snippet.length).toBeLessThanOrEqual(181);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).not.toMatch(/\swor…$/);
  });

  it('is empty for headings only', () => {
    expect(summarySnippet('# Title\n## More')).toBe('');
  });
});

describe('minutes library API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let cookie = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-library-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
    });
    const created = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    cookie = created.headers.get('set-cookie')?.split(';')[0] ?? '';
  });
  afterAll(() => test.close());

  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...json, cookie },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const library = async (query = '') =>
    (await (await call('GET', `/library${query}`)).json()) as LibraryDto;

  async function minute(
    title: string,
    heldAt: string,
    values: Partial<typeof meetings.$inferInsert> = {},
    { transcript = true, people = [] as string[], summary = '' } = {},
  ) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title,
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc',
        status: 'transcribed',
        startedAt: new Date(heldAt),
        ...values,
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    for (const name of people) {
      await test.db.insert(participants).values({ meetingId: meeting.id, displayName: name });
    }
    if (transcript) {
      await test.db.insert(transcriptSegments).values({
        meetingId: meeting.id,
        startMs: 0,
        endMs: 1000,
        text: `We talked about ${title} rollout.`,
      });
    }
    if (summary) {
      await test.db.insert(summaries).values({
        meetingId: meeting.id,
        provider: 'p',
        model: 'm',
        status: 'done',
        content: summary,
      });
    }
    return meeting.id;
  }

  it('requires a session', async () => {
    expect((await app.request('/api/library')).status).toBe(401);
  });

  it('lists only transcribed meetings with a transcript, newest meeting first', async () => {
    const older = await minute('Older', '2026-09-01T09:00:00Z', {}, { people: ['Anna', 'anna'] });
    const newer = await minute(
      'Newer',
      '2026-10-01T09:00:00Z',
      {},
      { summary: '## Notes\n\nShip it.' },
    );
    await minute('No transcript', '2026-10-02T09:00:00Z', {}, { transcript: false });
    await minute('Still processing', '2026-10-03T09:00:00Z', { status: 'processing' });
    await minute('Speakers only', '2026-10-04T09:00:00Z', {}, { people: ['Speaker 1', 'Bo'] });

    const { meetings: list } = await library();
    expect(list.map((m) => m.title)).toEqual(['Speakers only', 'Newer', 'Older']);
    expect(list.find((m) => m.id === newer)?.snippet).toBe('Ship it.');
    expect(list.find((m) => m.id === older)?.people.map((n) => n.toLowerCase())).toEqual(['anna']);
    expect(list[0]?.people).toEqual(['Bo']);
  });

  it('filters by search, platform and date range', async () => {
    await minute('Teams call', '2026-08-10T09:00:00Z', { platform: 'teams' }, { people: ['Zed'] });
    const titles = async (query: string) => (await library(query)).meetings.map((m) => m.title);
    expect(await titles('?q=teams')).toEqual(['Teams call']);
    expect(await titles('?q=zed')).toEqual(['Teams call']);
    expect(await titles('?q=rollout&platform=teams')).toEqual(['Teams call']);
    expect(await titles('?from=2026-09-01&to=2026-09-01')).toEqual(['Older']);
    expect(await titles('?platform=teams')).toEqual(['Teams call']);
    expect((await call('GET', '/library?from=yesterday')).status).toBe(400);
  });

  it('sets, normalises and clears a company by hand', async () => {
    const id = await minute('Acme call', '2026-07-01T09:00:00Z');
    const set = await call('PUT', `/library/meetings/${id}/company`, { company: '  Acme   Corp ' });
    expect(await set.json()).toEqual({ company: 'Acme Corp', source: 'manual' });

    const other = await minute('Second Acme call', '2026-07-02T09:00:00Z');
    const same = await call('PUT', `/library/meetings/${other}/company`, { company: 'acme corp' });
    expect(await same.json()).toEqual({ company: 'Acme Corp', source: 'manual' });
    expect((await library()).companies[0]).toBe('Acme Corp');

    const cleared = await call('PUT', `/library/meetings/${other}/company`, { company: ' ' });
    expect(await cleared.json()).toEqual({ company: null, source: null });
    expect(
      (await call('PUT', `/library/meetings/${id}/company`, { company: 'x'.repeat(81) })).status,
    ).toBe(400);
    expect(
      (await call('PUT', `/library/meetings/${missing}/company`, { company: 'A' })).status,
    ).toBe(404);
  });

  it('shows the company with its suggestions on the meeting page', async () => {
    const id = await minute('Detail', '2026-06-01T09:00:00Z', {
      company: 'Globex',
      companySource: 'ai',
    });
    const detail = (await (await call('GET', `/meetings/${id}`)).json()) as MeetingDetailDto;
    expect(detail.company).toMatchObject({ name: 'Globex', source: 'ai' });
    expect(detail.company.suggestions).toContain('Acme Corp');
  });

  it('merges companies with the rename tool and protects the result from the worker', async () => {
    const a = await minute('A', '2026-05-01T09:00:00Z', {
      company: 'Kestrel B.V.',
      companySource: 'ai',
    });
    const b = await minute('B', '2026-05-02T09:00:00Z', {
      company: 'Kestrel',
      companySource: 'calendar',
    });
    const renamed = await call('POST', '/library/companies/rename', {
      from: 'Kestrel B.V.',
      to: 'Kestrel',
    });
    expect(await renamed.json()).toEqual({ company: 'Kestrel', updated: 1 });
    const { meetings: list } = await library();
    expect(
      list
        .filter((m) => m.company === 'Kestrel')
        .map((m) => m.id)
        .sort(),
    ).toEqual([a, b].sort());
    expect(list.find((m) => m.id === a)?.companySource).toBe('manual');
    const none = await call('POST', '/library/companies/rename', { from: 'Nope', to: 'X' });
    expect(none.status).toBe(404);
    expect((await call('POST', '/library/companies/rename', { from: 'A' })).status).toBe(400);
  });

  it('creates, nests, renames and deletes folders without deleting minutes', async () => {
    const root = (await (
      await call('POST', '/library/folders', { name: ' Clients ' })
    ).json()) as FolderDto;
    expect(root).toMatchObject({ name: 'Clients', parentId: null });
    const child = (await (
      await call('POST', '/library/folders', { name: 'Acme', parentId: root.id })
    ).json()) as FolderDto;
    expect(child.parentId).toBe(root.id);
    expect((await call('POST', '/library/folders', { name: '' })).status).toBe(400);
    expect((await call('POST', '/library/folders', { name: 'X', parentId: missing })).status).toBe(
      404,
    );

    const renamed = await call('PATCH', `/library/folders/${child.id}`, { name: 'Acme Corp' });
    expect(await renamed.json()).toMatchObject({ name: 'Acme Corp' });

    const id = await minute('Filed', '2026-04-01T09:00:00Z');
    const moved = await call('PUT', `/library/meetings/${id}/folder`, { folderId: child.id });
    expect(await moved.json()).toEqual({ folderId: child.id });
    expect(
      (await call('PUT', `/library/meetings/${id}/folder`, { folderId: missing })).status,
    ).toBe(404);
    expect(
      (await call('PUT', `/library/meetings/${missing}/folder`, { folderId: null })).status,
    ).toBe(404);

    await call('DELETE', `/library/folders/${child.id}`);
    const after = await library();
    expect(after.meetings.find((m) => m.id === id)?.folderId).toBe(root.id);

    await call('DELETE', `/library/folders/${root.id}`);
    const final = await library();
    expect(final.meetings.find((m) => m.id === id)).toMatchObject({ folderId: null });
    expect(final.folders).toEqual([]);
    expect((await call('DELETE', `/library/folders/${root.id}`)).status).toBe(404);
  });

  it('leaves company and folder empty for meetings from before the upgrade', async () => {
    const id = await minute('Legacy', '2026-03-01T09:00:00Z');
    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, id));
    expect(row).toMatchObject({ company: null, companySource: null, folderId: null });
  });
});
