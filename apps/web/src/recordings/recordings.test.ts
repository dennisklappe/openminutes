import { mkdtemp, readFile } from 'node:fs/promises';
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
import { audioFiles, eq, meetingSources, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { PhoneSettingsDto, RecordingStatusDto } from '../dto.js';
import { phoneConfigRoutes, phoneSettingsRoutes } from '../settings/phone.js';
import { recordingRoutes } from './routes.js';

const secret = 'a-long-enough-test-secret';
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x61, 0x61]);
const json = { 'content-type': 'application/json' };
const id = '5c8d3a52-0000-4000-8000-000000000001';
const startedAt = '2026-10-22T14:05:09.000Z';

describe('phone recording API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: LocalStorage;
  let settings: SettingsStore;
  let app: Hono;
  const sent: { name: JobName; payload: JobPayloads[JobName] }[] = [];

  beforeAll(async () => {
    test = await createTestDatabase();
    storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-recordings-')));
    settings = new SettingsStore(test.db, secret);
    const queue = {
      send: (name: JobName, payload: JobPayloads[JobName]) => {
        sent.push({ name, payload });
        return Promise.resolve();
      },
    };
    app = new Hono()
      .route('/recordings', recordingRoutes({ db: test.db, queue, storage, settings }))
      .route('/phone', phoneConfigRoutes({ settings }))
      .route('/settings/phone', phoneSettingsRoutes({ settings }));
  });
  afterAll(() => test.close());

  const start = (body: unknown = { id, mimeType: 'audio/webm;codecs=opus', startedAt }) =>
    app.request('/recordings', { method: 'POST', headers: json, body: JSON.stringify(body) });
  const put = (index: number, data: string | Uint8Array, type = 'application/octet-stream') =>
    app.request(`/recordings/${id}/chunks/${index}`, {
      method: 'PUT',
      headers: { 'content-type': type },
      body: data,
    });
  const finish = (chunks: number) =>
    app.request(`/recordings/${id}/finish`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ chunks, durationMs: 4000 }),
    });
  const status = async () =>
    (await (await app.request(`/recordings/${id}`)).json()) as RecordingStatusDto;

  it('rejects unauthenticated requests', async () => {
    const full = createApp({
      db: test.db,
      settings,
      storage,
      secret,
      calendarProviders: createProviders(),
      version: '1.0.0',
      queue: { send: () => Promise.resolve() },
    });
    expect((await full.request(`/api/recordings/${id}`)).status).toBe(401);
    expect((await full.request('/api/phone')).status).toBe(401);
  });

  it('creates a recording idempotently', async () => {
    const created = await start();
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      id,
      status: 'uploading',
      received: [],
      maxChunkBytes: MAX_CHUNK_BYTES,
    });
    expect((await start()).status).toBe(200);

    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, id));
    expect(row).toMatchObject({
      title: 'Recording 22 Oct 2026, 14:05 UTC',
      platform: 'recording',
      joinUrl: `phone://${id}`,
      titleEdited: false,
    });
  });

  it('validates the start request', async () => {
    expect((await start({ id: 'nope', mimeType: 'audio/webm', startedAt })).status).toBe(400);
    const other = '5c8d3a52-0000-4000-8000-000000000002';
    expect((await start({ id: other, mimeType: 'video/mp4', startedAt })).status).toBe(400);
  });

  it('stores the number of speakers a recording starts with', async () => {
    const counted = '5c8d3a52-0000-4000-8000-000000000003';
    const base = { id: counted, mimeType: 'audio/webm', startedAt };
    expect((await start({ ...base, speakers: 4 })).status).toBe(201);
    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, counted));
    expect(row?.speakerCount).toBe(4);
    const other = '5c8d3a52-0000-4000-8000-000000000004';
    expect((await start({ ...base, id: other })).status).toBe(201);
    const [auto] = await test.db.select().from(meetings).where(eq(meetings.id, other));
    expect(auto?.speakerCount).toBeNull();
  });

  it('links a new recording to a calendar meeting and keeps it unlinked when that is gone', async () => {
    const [event] = await test.db
      .insert(meetings)
      .values({
        title: 'Budget review',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'skipped',
        scheduledStart: new Date('2026-10-22T14:00:00Z'),
        invitees: [
          { email: 'jo@acme.example', name: 'Jo Parker', declined: false },
          { email: 'ann@acme.example', name: 'Ann Lee', declined: false },
        ],
      })
      .returning();
    const linked = '5c8d3a52-0000-4000-8000-000000000005';
    const base = { id: linked, mimeType: 'audio/webm', startedAt };
    expect((await start({ ...base, eventId: event?.id })).status).toBe(201);
    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, linked));
    expect(row).toMatchObject({ title: 'Budget review', status: 'uploading', speakerCount: 2 });
    expect(row?.invitees).toHaveLength(2);
    expect(
      await test.db
        .select()
        .from(meetings)
        .where(eq(meetings.id, event?.id ?? '')),
    ).toEqual([]);

    const gone = '5c8d3a52-0000-4000-8000-000000000006';
    const missing = '5c8d3a52-0000-4000-8000-0000000000ff';
    expect((await start({ ...base, id: gone, eventId: missing })).status).toBe(201);
    const [kept] = await test.db.select().from(meetings).where(eq(meetings.id, gone));
    expect(kept?.title).toBe('Recording 22 Oct 2026, 14:05 UTC');
    expect(
      await test.db.select().from(meetingSources).where(eq(meetingSources.meetingId, gone)),
    ).toEqual([]);
    expect((await start({ ...base, id: gone, eventId: 'nope' })).status).toBe(400);
  });

  it.each([1, 6, 2.5, '3'])('refuses %s as a number of speakers', async (speakers) => {
    const other = '5c8d3a52-0000-4000-8000-000000000005';
    expect((await start({ id: other, mimeType: 'audio/webm', startedAt, speakers })).status).toBe(
      400,
    );
  });

  it('stores chunks idempotently and reports them for resuming', async () => {
    expect((await put(2, 'cc')).status).toBe(200);
    expect((await put(0, WEBM, 'audio/webm')).status).toBe(200);
    expect((await put(0, WEBM)).status).toBe(200);
    expect((await status()).received).toEqual([0, 2]);
  });

  it('refuses bad chunks', async () => {
    expect((await put(20_001, 'x')).status).toBe(400);
    expect((await put(1, 'x', 'text/plain')).status).toBe(415);
    expect((await put(1, new Uint8Array(MAX_CHUNK_BYTES + 1))).status).toBe(413);
    const missing = '5c8d3a52-0000-4000-8000-0000000000ff';
    const unknown = await app.request(`/recordings/${missing}/chunks/0`, {
      method: 'PUT',
      headers: { 'content-type': 'audio/webm' },
      body: 'x',
    });
    expect(unknown.status).toBe(404);
    expect((await status()).received).toEqual([0, 2]);
  });

  it('refuses to finish audio that is not in its declared format', async () => {
    const fake = '5c8d3a52-0000-4000-8000-000000000009';
    await start({ id: fake, mimeType: 'audio/webm', startedAt });
    const base = `/recordings/${fake}`;
    await app.request(`${base}/chunks/0`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: '#EXTM3U\n#EXT-X-TARGETDURATION:10\nfile:///etc/passwd\n',
    });
    const response = await app.request(`${base}/finish`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ chunks: 1, durationMs: 1000 }),
    });
    expect(response.status).toBe(422);
    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, fake));
    expect(row?.status).toBe('uploading');
    expect(sent.filter((job) => JSON.stringify(job.payload).includes(fake))).toEqual([]);
  });

  it('lists missing chunks when finishing too early', async () => {
    const response = await finish(3);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ missing: [1] });
  });

  it('finishes once, merging chunks and queueing one job', async () => {
    expect((await put(1, 'bb')).status).toBe(200);
    const [first, second] = await Promise.all([finish(3), finish(3)]);
    expect([first.status, second.status].sort()).toEqual([200, 202]);
    expect((await finish(3)).status).toBe(200);

    const files = await test.db.select().from(audioFiles).where(eq(audioFiles.meetingId, id));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ durationMs: 4000, codec: 'webm', size: 10 });
    expect(
      (await readFile(storage.absolutePath(files[0]?.path ?? ''))).toString('latin1').slice(4),
    ).toBe('aabbcc');
    expect(sent.filter((job) => job.name === 'meeting.process')).toEqual([
      { name: 'meeting.process', payload: { meetingId: id } },
    ]);

    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, id));
    expect(row?.status).toBe('ended');
    expect(row?.endedAt).not.toBeNull();
    expect((await status()).received).toEqual([]);
  });

  it('refuses chunks and deletion once finished', async () => {
    expect((await put(5, 'x')).status).toBe(409);
    expect((await app.request(`/recordings/${id}`, { method: 'DELETE' })).status).toBe(409);
  });

  it('discards an unfinished recording', async () => {
    const other = '5c8d3a52-0000-4000-8000-000000000003';
    await start({ id: other, mimeType: 'audio/mp4', startedAt });
    await app.request(`/recordings/${other}/chunks/0`, {
      method: 'PUT',
      headers: { 'content-type': 'audio/mp4' },
      body: 'x',
    });
    expect((await app.request(`/recordings/${other}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/recordings/${other}`)).status).toBe(404);
    expect(await storage.exists(`meetings/${other}/chunks/000000.part`)).toBe(false);
  });

  it('serves and updates the phone settings', async () => {
    const read = async () =>
      (await (await app.request('/settings/phone')).json()) as PhoneSettingsDto;
    const initial = await read();
    expect(initial.enabled).toBe(true);
    expect(initial.consentText).toBe(initial.defaults.consentText);

    const save = (body: unknown) =>
      app.request('/settings/phone', { method: 'PUT', headers: json, body: JSON.stringify(body) });
    expect((await save({ enabled: true, consentText: 'x'.repeat(1001) })).status).toBe(400);
    await save({ enabled: true, consentText: 'Ask first.' });
    expect(await (await app.request('/phone')).json()).toEqual({
      enabled: true,
      consentText: 'Ask first.',
    });
    await save({ enabled: true, consentText: '  ' });
    expect((await read()).consentText).toBe(initial.defaults.consentText);
  });

  it('refuses new recordings while the feature is off', async () => {
    await settings.set('phone.enabled', 'false');
    const other = '5c8d3a52-0000-4000-8000-000000000004';
    expect((await start({ id: other, mimeType: 'audio/webm', startedAt })).status).toBe(403);
    await settings.set('phone.enabled', 'true');
  });
});
