import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import {
  LocalStorage,
  MAX_CHUNK_BYTES,
  SettingsStore,
  type JobName,
  type JobPayloads,
} from '@openminutes/core';
import { SYNTHETIC_MEETINGS, syntheticExport, tarGz, zipArchive } from '@openminutes/core/testing';
import { eq, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { ImportConfigDto, ImportPreviewDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const [planning, klant] = SYNTHETIC_MEETINGS;
const KEYS = [planning?.id ?? '', klant?.id ?? ''];

describe('Fireflies import API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: LocalStorage;
  let settings: SettingsStore;
  let app: Hono;
  let cookie = '';
  let counter = 0;
  const sent: { name: JobName; payload: JobPayloads[JobName] }[] = [];

  beforeAll(async () => {
    test = await createTestDatabase();
    storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-import-')));
    settings = new SettingsStore(test.db, secret);
    app = createApp({
      db: test.db,
      settings,
      storage,
      secret,
      calendarProviders: createProviders(),
      version: '1.0.0',
      importMaxBytes: 200_000,
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
    cookie = created.headers.get('set-cookie')?.split(';')[0] ?? '';
  });
  afterAll(() => test.close());

  const newId = () => `5c8d3a52-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const request = (path: string, init: RequestInit = {}) =>
    app.request(`/api/imports${path}`, {
      ...init,
      headers: { cookie, origin: 'http://localhost', ...(init.headers as Record<string, string>) },
    });
  const put = (
    id: string,
    index: number,
    body: Uint8Array | Buffer,
    type = 'application/octet-stream',
  ) =>
    request(`/${id}/chunks/${String(index)}`, {
      method: 'PUT',
      headers: { 'content-type': type },
      body,
    });
  const post = (path: string, body: unknown) =>
    request(path, { method: 'POST', headers: json, body: JSON.stringify(body) });

  async function upload(archive: Buffer, pieces = 3): Promise<{ id: string; response: Response }> {
    const id = newId();
    const size = Math.ceil(archive.length / pieces);
    for (let i = 0; i < pieces; i++) {
      expect((await put(id, i, archive.subarray(i * size, (i + 1) * size))).status).toBe(200);
    }
    return { id, response: await post(`/${id}/finish`, { chunks: pieces }) };
  }

  it('needs a session for every route', async () => {
    const id = newId();
    for (const [method, path] of [
      ['GET', '/config'],
      ['PUT', `/${id}/chunks/0`],
      ['POST', `/${id}/finish`],
      ['GET', `/${id}`],
      ['POST', `/${id}/start`],
      ['DELETE', `/${id}`],
    ] as const) {
      const response = await app.request(`/api/imports${path}`, {
        method,
        headers: { origin: 'http://localhost' },
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it('describes what it can do', async () => {
    const config = (await (await request('/config')).json()) as ImportConfigDto;
    expect(config).toEqual({ maxBytes: 200_000, chunkBytes: MAX_CHUNK_BYTES });
  });

  it('takes chunks above the API body limit and lists the meetings of a tar.gz, newest first', async () => {
    const big = 5 * 1024 * 1024;
    const id = newId();
    expect((await put(id, 0, Buffer.alloc(big))).status).toBe(413);
    const { response } = await upload(tarGz(syntheticExport()));
    expect(response.status).toBe(201);
    const preview = (await response.json()) as ImportPreviewDto;
    expect(preview.unreadable).toBe(0);
    expect(
      preview.meetings.map(({ key, title, hasAudio, attendees }) => ({
        key,
        title,
        hasAudio,
        attendees,
      })),
    ).toEqual([
      { key: KEYS[1], title: 'Klantgesprek', hasAudio: false, attendees: 1 },
      { key: KEYS[0], title: 'Weekly planning', hasAudio: true, attendees: 2 },
    ]);
    expect(preview.meetings.every((m) => m.meeting === null)).toBe(true);
  });

  it('lists a zip too', async () => {
    const { response } = await upload(zipArchive(syntheticExport()), 2);
    expect(response.status).toBe(201);
    expect(((await response.json()) as ImportPreviewDto).meetings).toHaveLength(2);
  });

  it('refuses an upload past the configured limit', async () => {
    const id = newId();
    expect((await put(id, 0, Buffer.alloc(150_000))).status).toBe(200);
    expect((await put(id, 1, Buffer.alloc(150_000))).status).toBe(413);
  });

  it('answers a bad chunk with a clear status', async () => {
    const id = newId();
    expect((await put(id, 0, Buffer.from('x'), 'text/plain')).status).toBe(415);
    expect(
      (
        await request(`/${id}/chunks/99999`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: 'x',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request('/nope/chunks/0', {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: 'x',
        })
      ).status,
    ).toBe(400);
  });

  it('reports missing chunks', async () => {
    const id = newId();
    await put(id, 0, Buffer.from('x'));
    const response = await post(`/${id}/finish`, { chunks: 3 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ missing: [1, 2] });
  });

  it('rejects an archive with a path traversal and leaves nothing behind', async () => {
    const { id, response } = await upload(
      tarGz([{ name: '../../evil/transcript.json', data: '{}' }]),
      1,
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toContain('unsafe');
    expect((await request(`/${id}`)).status).toBe(404);
    expect(await readdir(storage.absolutePath('imports')).then((names) => names.includes(id))).toBe(
      false,
    );
  });

  it('rejects a file that is not an archive', async () => {
    const { response } = await upload(Buffer.from('not an archive at all'), 1);
    expect(response.status).toBe(422);
  });

  describe('starting', () => {
    let id: string;
    beforeAll(async () => {
      id = (await upload(tarGz(syntheticExport()))).id;
    });

    it('validates the request', async () => {
      expect((await post(`/${id}/start`, { keys: [] })).status).toBe(400);
      expect((await post(`/${id}/start`, { keys: ['01UNKNOWN'] })).status).toBe(400);
      expect((await post(`/${newId()}/start`, { keys: KEYS })).status).toBe(404);
      const noAudio = await post(`/${id}/start`, { keys: [KEYS[1]] });
      expect(noAudio.status).toBe(400);
      expect(((await noAudio.json()) as { error: string }).error).toContain('no recording');
    });

    it('creates the meetings, queues one job each and drops the files of the others', async () => {
      sent.length = 0;
      const response = await post(`/${id}/start`, { keys: [KEYS[0]] });
      expect(response.status).toBe(202);
      const [row] = await test.db
        .select()
        .from(meetings)
        .where(eq(meetings.externalId, `fireflies:${KEYS[0] ?? ''}`));
      expect(row).toMatchObject({
        title: 'Weekly planning',
        platform: 'imported',
        status: 'ended',
        joinUrl: `https://app.fireflies.ai/view/${KEYS[0] ?? ''}`,
        invitees: [
          { email: 'alice@example.com', name: null, declined: false },
          { email: 'bob@example.com', name: null, declined: false },
        ],
      });
      expect(row?.startedAt?.toISOString()).toBe('2026-10-01T09:00:00.000Z');
      expect(row?.endedAt?.toISOString()).toBe('2026-10-01T09:12:00.000Z');
      expect(sent).toEqual([
        {
          name: 'meeting.import',
          payload: {
            meetingId: row?.id,
            uploadId: id,
            firefliesId: KEYS[0],
          },
        },
      ]);
      const left = await readdir(storage.absolutePath(`imports/${id}/meetings`));
      expect(left).toEqual([KEYS[0]]);
    });

    it('does not queue a meeting twice and shows it as imported', async () => {
      sent.length = 0;
      const response = await post(`/${id}/start`, { keys: [KEYS[0]] });
      expect(sent).toEqual([]);
      const preview = (await response.json()) as ImportPreviewDto;
      expect(preview.meetings.find((m) => m.key === KEYS[0])?.meeting).toMatchObject({
        status: 'ended',
      });
      expect(await readdir(storage.absolutePath(`imports/${id}/meetings`))).toEqual([KEYS[0]]);
    });

    it('skips a meeting that an earlier import brought in', async () => {
      const again = (await upload(tarGz(syntheticExport()))).id;
      sent.length = 0;
      await post(`/${again}/start`, { keys: [KEYS[0]] });
      expect(sent).toEqual([]);
      const rows = await test.db.select({ id: meetings.id }).from(meetings);
      expect(rows).toHaveLength(1);
    });

    it('queues a failed meeting again', async () => {
      await test.db
        .update(meetings)
        .set({ status: 'failed', error: 'Import failed: boom' })
        .where(eq(meetings.externalId, `fireflies:${KEYS[0] ?? ''}`));
      sent.length = 0;
      await post(`/${id}/start`, { keys: [KEYS[0]] });
      expect(sent).toHaveLength(1);
      const [row] = await test.db
        .select()
        .from(meetings)
        .where(eq(meetings.externalId, `fireflies:${KEYS[0] ?? ''}`));
      expect(row).toMatchObject({ status: 'ended', error: null });
    });

    it('stores the number of speakers on a new or retried meeting, Auto leaves it empty', async () => {
      const key = `fireflies:${KEYS[0] ?? ''}`;
      const speakerCount = async () =>
        (await test.db.select().from(meetings).where(eq(meetings.externalId, key)))[0]
          ?.speakerCount;
      expect(await speakerCount()).toBeNull();
      await test.db.update(meetings).set({ status: 'failed' }).where(eq(meetings.externalId, key));
      await post(`/${id}/start`, { keys: [KEYS[0]], speakers: 2 });
      expect(await speakerCount()).toBe(2);
      await test.db.update(meetings).set({ status: 'failed' }).where(eq(meetings.externalId, key));
      await post(`/${id}/start`, { keys: [KEYS[0]] });
      expect(await speakerCount()).toBeNull();
    });

    it('links a new meeting to the calendar meeting that was chosen for it', async () => {
      const upload2 = (await upload(tarGz(syntheticExport()))).id;
      const [event] = await test.db
        .insert(meetings)
        .values({
          title: 'Budget review',
          platform: 'meet',
          joinUrl: 'https://meet.google.com/xyz-wxyz-xyz',
          status: 'skipped',
          scheduledStart: new Date('2026-10-01T09:00:00Z'),
          invitees: [
            { email: 'jo@acme.example', name: 'Jo Parker', declined: false },
            { email: 'ann@acme.example', name: 'Ann Lee', declined: false },
            { email: 'sam@acme.example', name: 'Sam Roe', declined: false },
          ],
        })
        .returning();
      const key = `fireflies:${KEYS[0] ?? ''}`;
      await test.db.delete(meetings).where(eq(meetings.externalId, key));
      const response = await post(`/${upload2}/start`, {
        keys: [KEYS[0]],
        events: { [KEYS[0] ?? '']: event?.id },
      });
      expect(response.status).toBe(202);
      const [row] = await test.db.select().from(meetings).where(eq(meetings.externalId, key));
      expect(row).toMatchObject({ title: 'Budget review', speakerCount: 3, status: 'ended' });
      expect(row?.invitees?.map((invitee) => invitee.email)).toEqual([
        'jo@acme.example',
        'ann@acme.example',
        'sam@acme.example',
        'alice@example.com',
        'bob@example.com',
      ]);
      expect(
        await test.db
          .select()
          .from(meetings)
          .where(eq(meetings.id, event?.id ?? '')),
      ).toEqual([]);
    });

    it('refuses a link that is not a meeting id', async () => {
      expect((await post(`/${id}/start`, { keys: [KEYS[0]], events: { a: 'nope' } })).status).toBe(
        400,
      );
    });

    it.each([1, 6, 2.5, '3'])('refuses %s as a number of speakers', async (speakers) => {
      expect((await post(`/${id}/start`, { keys: [KEYS[0]], speakers })).status).toBe(400);
    });

    it('will not discard an import that is running, and discards it otherwise', async () => {
      expect((await request(`/${id}`, { method: 'DELETE' })).status).toBe(409);
      await test.db.update(meetings).set({ status: 'transcribed' });
      expect((await request(`/${id}`, { method: 'DELETE' })).status).toBe(200);
      expect((await request(`/${id}`)).status).toBe(404);
    });
  });
});
