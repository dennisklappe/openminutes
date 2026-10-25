import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { audioFiles, meetings, summaries, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { BulkResultDto, LibraryDto, MeetingDetailDto, MeetingListItemDto } from '../dto.js';
import { createShareLink } from '../minutes/share-routes.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const DAY_MS = 24 * 60 * 60 * 1000;

describe('archive and bin API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: LocalStorage;
  let app: Hono;
  let cookie = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-bin-api-')));
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage,
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
    app.request(`/api/meetings${path}`, {
      method,
      headers: {
        cookie,
        origin: 'http://localhost',
        ...(body !== undefined && json),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const list = async (scope = '', query = '') =>
    (await (
      await call('GET', `?${scope && `scope=${scope}&`}${query}`)
    ).json()) as MeetingListItemDto[];
  const ids = async (scope?: string, query?: string) => (await list(scope, query)).map((m) => m.id);

  async function insert(
    status: typeof meetings.$inferInsert.status = 'transcribed',
    extra: Partial<typeof meetings.$inferInsert> = {},
  ) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Weekly',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status,
        startedAt: new Date('2026-03-12T09:30:00Z'),
        ...extra,
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    await test.db
      .insert(transcriptSegments)
      .values({ meetingId: meeting.id, startMs: 0, endMs: 1000, text: 'quarterly numbers' });
    return meeting;
  }

  it('hides an archived meeting from the lists and search but keeps it whole', async () => {
    const meeting = await insert('transcribed', { title: 'Archive me' });
    await test.db.insert(summaries).values({
      meetingId: meeting.id,
      provider: 'p',
      model: 'm',
      status: 'done',
      content: 'kept',
    });

    expect((await call('POST', `/${meeting.id}/archive`)).status).toBe(200);

    expect(await ids()).not.toContain(meeting.id);
    expect(await ids('', 'q=quarterly')).not.toContain(meeting.id);
    expect(await ids('archived')).toEqual([meeting.id]);
    expect(await ids('archived', 'q=quarterly')).toEqual([meeting.id]);
    const library = (await (
      await app.request('/api/library', { headers: { cookie } })
    ).json()) as LibraryDto;
    expect(library.meetings.map((m) => m.id)).not.toContain(meeting.id);

    const detail = (await (await call('GET', `/${meeting.id}`)).json()) as MeetingDetailDto;
    expect(detail.meeting.archivedAt).not.toBeNull();
    expect(detail.summaries).toHaveLength(1);
    expect(detail.segments).toHaveLength(1);
    expect((await call('GET', `/${meeting.id}/transcript.md`)).status).toBe(200);

    expect((await call('POST', `/${meeting.id}/archive`)).status).toBe(409);
    expect((await call('POST', `/${meeting.id}/unarchive`)).status).toBe(200);
    expect(await ids()).toContain(meeting.id);
    expect(await ids('archived')).toEqual([]);
    expect((await call('POST', `/${meeting.id}/unarchive`)).status).toBe(409);
  });

  it('keeps share links of an archived meeting working', async () => {
    const meeting = await insert();
    const share = await createShareLink(test.db, meeting.id, {
      includeTranscript: false,
      expiresInDays: null,
    });
    await call('POST', `/${meeting.id}/archive`);
    expect((await app.request(`/s/${share.token}`)).status).toBe(200);
  });

  it('moves a deleted meeting to the bin and stops its share link at once', async () => {
    const meeting = await insert('transcribed', { title: 'Delete me' });
    const share = await createShareLink(test.db, meeting.id, {
      includeTranscript: false,
      expiresInDays: null,
    });
    expect((await app.request(`/s/${share.token}`)).status).toBe(200);

    expect((await call('DELETE', `/${meeting.id}`)).status).toBe(200);

    expect((await app.request(`/s/${share.token}`)).status).toBe(404);
    expect(await ids()).not.toContain(meeting.id);
    expect(await ids('', 'q=quarterly')).not.toContain(meeting.id);
    expect(await ids('archived')).not.toContain(meeting.id);
    const binned = (await list('bin')).find((m) => m.id === meeting.id);
    expect(binned?.deletedAt).not.toBeNull();
    const deletedAt = new Date(binned?.deletedAt ?? '').getTime();
    expect(new Date(binned?.purgeAt ?? '').getTime() - deletedAt).toBe(30 * DAY_MS);
    expect((await call('GET', `/${meeting.id}`)).status).toBe(404);
    expect((await call('GET', `/${meeting.id}/audio`)).status).toBe(404);
    expect((await call('GET', `/${meeting.id}/transcript.json`)).status).toBe(404);
  });

  it('restores from the bin and gives the meeting back to the lists', async () => {
    const meeting = await insert();
    await call('DELETE', `/${meeting.id}`);
    expect((await call('POST', `/${meeting.id}/restore`)).status).toBe(200);
    expect(await ids()).toContain(meeting.id);
    expect(await ids('bin')).not.toContain(meeting.id);
    expect((await call('POST', `/${meeting.id}/restore`)).status).toBe(409);
  });

  it('deletes forever only from the bin and removes the audio', async () => {
    const meeting = await insert();
    const path = `meetings/${meeting.id}/000.opus`;
    await storage.write(path, Buffer.from('part'));
    await storage.write(`meetings/${meeting.id}/merged.opus`, Buffer.from('merged'));
    await test.db
      .insert(audioFiles)
      .values({ meetingId: meeting.id, path, durationMs: 1000, codec: 'opus', size: 4 });

    expect((await call('DELETE', `/${meeting.id}?forever=1`)).status).toBe(409);
    expect(await storage.exists(path)).toBe(true);

    await call('DELETE', `/${meeting.id}`);
    expect((await call('DELETE', `/${meeting.id}?forever=1`)).status).toBe(200);

    expect(await storage.exists(path)).toBe(false);
    expect(await storage.exists(`meetings/${meeting.id}`)).toBe(false);
    expect(await ids('bin')).not.toContain(meeting.id);
    expect((await call('POST', `/${meeting.id}/restore`)).status).toBe(404);
  });

  it('refuses to delete or archive what is running or upcoming', async () => {
    const running = await insert('recording');
    const upcoming = await insert('scheduled', {
      scheduledStart: new Date(Date.now() + 3 * 3_600_000),
    });
    for (const meeting of [running, upcoming]) {
      expect((await call('DELETE', `/${meeting.id}`)).status).toBe(409);
      expect((await call('POST', `/${meeting.id}/archive`)).status).toBe(409);
      const detail = (await (await call('GET', `/${meeting.id}`)).json()) as MeetingDetailDto;
      expect(detail.canDelete).toBe(false);
    }
    expect(await ids('bin')).not.toContain(running.id);
    expect((await call('DELETE', `/${crypto.randomUUID()}`)).status).toBe(404);
  });

  it('works on many meetings at once and reports what it skipped', async () => {
    const a = await insert();
    const b = await insert();
    const running = await insert('processing');

    const archived = (await (
      await call('POST', '/bulk', { action: 'archive', ids: [a.id, b.id, running.id, a.id] })
    ).json()) as BulkResultDto;
    expect(archived).toEqual({ changed: 2, skipped: 1 });
    expect(await ids('archived')).toEqual(expect.arrayContaining([a.id, b.id]));

    const binned = (await (
      await call('POST', '/bulk', { action: 'delete', ids: [a.id, b.id] })
    ).json()) as BulkResultDto;
    expect(binned).toEqual({ changed: 2, skipped: 0 });
    expect(await ids('archived')).not.toContain(a.id);

    const purged = (await (
      await call('POST', '/bulk', { action: 'purge', ids: [a.id, running.id] })
    ).json()) as BulkResultDto;
    expect(purged).toEqual({ changed: 1, skipped: 1 });

    const restored = (await (
      await call('POST', '/bulk', { action: 'restore', ids: [b.id] })
    ).json()) as BulkResultDto;
    expect(restored).toEqual({ changed: 1, skipped: 0 });
    expect(await ids('archived')).toContain(b.id);
  });

  it('validates bulk requests', async () => {
    expect((await call('POST', '/bulk', { action: 'archive', ids: [] })).status).toBe(400);
    expect(
      (await call('POST', '/bulk', { action: 'nuke', ids: [crypto.randomUUID()] })).status,
    ).toBe(400);
    expect((await call('POST', '/bulk', { action: 'archive', ids: ['nope'] })).status).toBe(400);
  });
});
