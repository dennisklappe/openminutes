import {
  assembleChunks,
  ChunkLimitError,
  loadPhoneConfig,
  loadRecordingFormat,
  MAX_CHUNK_BYTES,
  MAX_CHUNK_INDEX,
  matchesFormat,
  missingChunks,
  readChunkHead,
  receivedChunks,
  recordingFormat,
  removeChunks,
  removeRecordingFolder,
  saveChunk,
  saveRecordingFormat,
  type JobSender,
  type LocalStorage,
  type SettingsStore,
  loadTimeZone,
} from '@openminutes/core';
import { and, audioFiles, eq, meetings, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { Readable } from 'node:stream';
import type { ReadableStream as WebStream } from 'node:stream/web';
import { z } from 'zod';
import type { RecordingStartInput, RecordingStatusDto } from '../dto.js';
import { MAX_SPEAKERS, MIN_SPEAKERS } from '../speakerCount.js';
import { recordingTitle } from './title.js';

interface RecordingDeps {
  db: Database;
  queue: JobSender;
  storage: LocalStorage;
  settings: SettingsStore;
}

const speakerCount = z.int().min(MIN_SPEAKERS).max(MAX_SPEAKERS);
const start = z.object({
  id: z.uuid(),
  mimeType: z.string().max(200),
  startedAt: z.iso.datetime({ offset: true }),
  speakers: speakerCount.optional(),
}) satisfies z.ZodType<RecordingStartInput>;
const finish = z.object({
  chunks: z
    .int()
    .min(1)
    .max(MAX_CHUNK_INDEX + 1),
  durationMs: z.int().min(0),
});
const uuid = z.uuid();
const chunkIndex = z.coerce.number().int().min(0).max(MAX_CHUNK_INDEX);
const CHUNK_TYPE = /^(application\/octet-stream|audio\/[\w.+-]+)(;.*)?$/i;

export function recordingRoutes(deps: RecordingDeps): Hono {
  const routes = new Hono();

  async function find(rawId: string) {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const [row] = await deps.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id.data), eq(meetings.platform, 'recording')));
    return row;
  }

  const statusOf = async (row: typeof meetings.$inferSelect): Promise<RecordingStatusDto> => ({
    id: row.id,
    status: row.status,
    received: await receivedChunks(deps.storage, row.id),
    maxChunkBytes: MAX_CHUNK_BYTES,
  });

  routes.post('/', async (c) => {
    if (!(await loadPhoneConfig(deps.settings)).enabled) {
      return c.json({ error: 'Phone recording is turned off' }, 403);
    }
    const body = start.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid recording' }, 400);
    const format = recordingFormat(body.data.mimeType);
    if (!format) return c.json({ error: 'Unsupported audio format' }, 400);

    const startedAt = new Date(body.data.startedAt);
    const [created] = await deps.db
      .insert(meetings)
      .values({
        id: body.data.id,
        title: recordingTitle(startedAt, await loadTimeZone(deps.settings)),
        platform: 'recording',
        joinUrl: `phone://${body.data.id}`,
        status: 'uploading',
        startedAt,
        speakerCount: body.data.speakers ?? null,
      })
      .onConflictDoNothing()
      .returning();
    const row = created ?? (await find(body.data.id));
    if (!row) return c.json({ error: 'That id belongs to another meeting' }, 409);
    if (created) await saveRecordingFormat(deps.storage, row.id, format);
    return c.json(await statusOf(row), created ? 201 : 200);
  });

  routes.get('/:id', async (c) => {
    const row = await find(c.req.param('id'));
    if (!row) return c.json({ error: 'Recording not found' }, 404);
    return c.json(await statusOf(row));
  });

  routes.put('/:id/chunks/:index', async (c) => {
    const row = await find(c.req.param('id'));
    if (!row) return c.json({ error: 'Recording not found' }, 404);
    const index = chunkIndex.safeParse(c.req.param('index'));
    if (!index.success) return c.json({ error: 'Invalid chunk index' }, 400);
    if (!CHUNK_TYPE.test(c.req.header('content-type') ?? '')) {
      return c.json({ error: 'Send the chunk as application/octet-stream or audio/*' }, 415);
    }
    if (row.status !== 'uploading') return c.json({ error: 'This recording is finished' }, 409);
    const length = Number(c.req.header('content-length'));
    if (length > MAX_CHUNK_BYTES) return c.json({ error: 'Chunk too large' }, 413);
    const stream = c.req.raw.body;
    if (!stream) return c.json({ error: 'The chunk is empty' }, 400);

    try {
      await saveChunk(
        deps.storage,
        row.id,
        index.data,
        Readable.fromWeb(stream as WebStream<Uint8Array>),
      );
    } catch (error) {
      if (error instanceof ChunkLimitError) return c.json({ error: error.message }, 413);
      throw error;
    }
    return c.json({ ok: true });
  });

  routes.post('/:id/finish', async (c) => {
    const row = await find(c.req.param('id'));
    if (!row) return c.json({ error: 'Recording not found' }, 404);
    const body = finish.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid finish request' }, 400);
    if (row.status !== 'uploading') return c.json(await statusOf(row), 200);

    const missing = missingChunks(await receivedChunks(deps.storage, row.id), body.data.chunks);
    if (missing.length > 0) {
      return c.json({ error: 'Some chunks are missing', missing }, 409);
    }
    const format = await loadRecordingFormat(deps.storage, row.id);
    if (!matchesFormat(format, await readChunkHead(deps.storage, row.id, 0))) {
      return c.json({ error: 'The audio does not match its declared format' }, 422);
    }
    const file = await assembleChunks(deps.storage, row.id, body.data.chunks, format);

    const won = await deps.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(meetings)
        .set({ status: 'ended', endedAt: new Date() })
        .where(and(eq(meetings.id, row.id), eq(meetings.status, 'uploading')))
        .returning({ id: meetings.id });
      if (!claimed) return false;
      await tx.insert(audioFiles).values({
        meetingId: row.id,
        path: file.path,
        durationMs: body.data.durationMs,
        codec: format.codec,
        size: file.size,
      });
      return true;
    });
    if (won) {
      await removeChunks(deps.storage, row.id);
      await deps.queue.send('meeting.process', { meetingId: row.id });
    }
    const [current] = await deps.db.select().from(meetings).where(eq(meetings.id, row.id));
    return c.json(await statusOf(current ?? row), won ? 202 : 200);
  });

  routes.delete('/:id', async (c) => {
    const row = await find(c.req.param('id'));
    if (!row) return c.json({ error: 'Recording not found' }, 404);
    const [removed] = await deps.db
      .delete(meetings)
      .where(and(eq(meetings.id, row.id), eq(meetings.status, 'uploading')))
      .returning({ id: meetings.id });
    if (!removed) return c.json({ error: 'This recording is finished' }, 409);
    await removeRecordingFolder(deps.storage, row.id);
    return c.json({ ok: true });
  });

  return routes;
}
