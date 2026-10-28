import {
  ArchiveError,
  ChunkLimitError,
  importChunks,
  loadStaged,
  MAX_CHUNK_BYTES,
  MAX_CHUNK_INDEX,
  missingChunks,
  removeImport,
  stageExport,
  stagedMeetingFolder,
  uploadPath,
  type JobSender,
  type LocalStorage,
} from '@openminutes/core';
import { and, inArray, meetings, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { Readable } from 'node:stream';
import type { ReadableStream as WebStream } from 'node:stream/web';
import { z } from 'zod';
import type { ImportFinishInput, ImportStartInput } from '../dto.js';
import { MAX_SPEAKERS, MIN_SPEAKERS } from '../speakerCount.js';
import { loadImportConfig, MAX_IMPORT_FILES } from './config.js';
import { externalId, loadPreview } from './preview.js';
import { startImport } from './start.js';

interface ImportDeps {
  db: Database;
  queue: JobSender;
  storage: LocalStorage;
  importMaxBytes: number;
}

const uuid = z.uuid();
const chunkIndex = z.coerce.number().int().min(0).max(MAX_CHUNK_INDEX);
const finish = z.object({
  chunks: z
    .int()
    .min(1)
    .max(MAX_CHUNK_INDEX + 1),
}) satisfies z.ZodType<ImportFinishInput>;
const start = z.object({
  keys: z.array(z.string().min(1).max(64)).min(1).max(MAX_IMPORT_FILES),
  speakers: z.int().min(MIN_SPEAKERS).max(MAX_SPEAKERS).optional(),
}) satisfies z.ZodType<ImportStartInput>;
const CHUNK_TYPE = /^application\/octet-stream(;.*)?$/i;
const RUNNING = ['ended', 'processing'] as const;

export function importRoutes(deps: ImportDeps): Hono {
  const routes = new Hono();
  const limits = { maxBytes: deps.importMaxBytes, maxEntries: MAX_IMPORT_FILES };

  routes.get('/config', (c) => c.json(loadImportConfig(deps.importMaxBytes)));

  routes.put('/:id/chunks/:index', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    const index = chunkIndex.safeParse(c.req.param('index'));
    if (!id.success || !index.success) return c.json({ error: 'Invalid upload' }, 400);
    if (!CHUNK_TYPE.test(c.req.header('content-type') ?? '')) {
      return c.json({ error: 'Send the chunk as application/octet-stream' }, 415);
    }
    if (Number(c.req.header('content-length')) > MAX_CHUNK_BYTES) {
      return c.json({ error: 'Chunk too large' }, 413);
    }
    if (await loadStaged(deps.storage, id.data)) {
      return c.json({ error: 'This upload is finished' }, 409);
    }
    const stream = c.req.raw.body;
    if (!stream) return c.json({ error: 'The chunk is empty' }, 400);
    try {
      await importChunks(deps.storage, id.data, deps.importMaxBytes).save(
        index.data,
        Readable.fromWeb(stream as WebStream<Uint8Array>),
      );
    } catch (error) {
      if (error instanceof ChunkLimitError) {
        return c.json({ error: 'The export is larger than this server accepts' }, 413);
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  routes.post('/:id/finish', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    const body = finish.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success) return c.json({ error: 'Invalid finish request' }, 400);
    if (await loadStaged(deps.storage, id.data)) {
      return c.json(await loadPreview(deps, id.data), 200);
    }
    const chunks = importChunks(deps.storage, id.data, deps.importMaxBytes);
    const missing = missingChunks(await chunks.received(), body.data.chunks);
    if (missing.length > 0) return c.json({ error: 'Some chunks are missing', missing }, 409);
    try {
      await chunks.assemble(body.data.chunks, uploadPath(id.data));
      await chunks.remove();
      await stageExport(deps.storage, id.data, limits);
    } catch (error) {
      await removeImport(deps.storage, id.data);
      if (error instanceof ArchiveError) return c.json({ error: error.message }, 422);
      throw error;
    }
    return c.json(await loadPreview(deps, id.data), 201);
  });

  routes.get('/:id', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    const preview = id.success ? await loadPreview(deps, id.data) : undefined;
    if (!preview)
      return c.json({ error: 'This import was not found, upload the export again' }, 404);
    return c.json(preview);
  });

  routes.post('/:id/start', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    const body = start.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success) return c.json({ error: 'Invalid import request' }, 400);
    const staged = await loadStaged(deps.storage, id.data);
    if (!staged)
      return c.json({ error: 'This import was not found, upload the export again' }, 404);
    const known = new Map(staged.meetings.map((meeting) => [meeting.id, meeting]));
    if (!body.data.keys.every((key) => known.has(key))) {
      return c.json({ error: 'Some of these meetings are not in the export' }, 400);
    }
    if (!body.data.keys.every((key) => known.get(key)?.hasAudio)) {
      return c.json({ error: 'Some of these meetings have no recording to import' }, 400);
    }
    const present = await Promise.all(
      body.data.keys.map((key) => deps.storage.exists(stagedMeetingFolder(id.data, key))),
    );
    if (present.includes(false)) {
      return c.json(
        { error: 'Some of these meetings were left out earlier, upload the export again' },
        409,
      );
    }
    await startImport(deps, id.data, staged.meetings, body.data);
    return c.json(await loadPreview(deps, id.data), 202);
  });

  routes.delete('/:id', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Invalid upload' }, 400);
    const staged = await loadStaged(deps.storage, id.data);
    if (staged) {
      const [running] = await deps.db
        .select({ id: meetings.id })
        .from(meetings)
        .where(
          and(
            inArray(
              meetings.externalId,
              staged.meetings.map((meeting) => externalId(meeting.id)),
            ),
            inArray(meetings.status, [...RUNNING]),
          ),
        )
        .limit(1);
      if (running)
        return c.json({ error: 'Meetings of this import are still being imported' }, 409);
    }
    await removeImport(deps.storage, id.data);
    return c.json({ ok: true });
  });

  return routes;
}
