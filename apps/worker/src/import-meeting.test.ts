import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AudioStorage,
  extractExport,
  LocalStorage,
  type ImportJobPayload,
  type JobName,
  type JobPayloads,
} from '@openminutes/core';
import { SYNTHETIC_MEETINGS, syntheticExport, tarGz } from '@openminutes/core/testing';
import { audioFiles, eq, meetings, summaries, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importMeeting, type ImportDeps } from './import-meeting.js';

const [planning, klant] = SYNTHETIC_MEETINGS;

describe('importMeeting', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let local: LocalStorage;
  let uploadId = 0;
  let sent: { name: JobName; payload: JobPayloads[JobName] }[];

  const deps = (): ImportDeps => ({
    db: test.db,
    local,
    queue: {
      send: (name, payload) => {
        sent.push({ name, payload });
        return Promise.resolve();
      },
    },
    loadStorage: () => Promise.resolve(new AudioStorage(local)),
    probeDuration: () => Promise.resolve(61_000),
  });

  beforeAll(async () => {
    test = await createTestDatabase();
    local = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-import-worker-')));
  });
  afterAll(() => test.close());
  beforeEach(() => {
    sent = [];
  });

  async function stage() {
    const id = `00000000-0000-4000-8000-${String(++uploadId).padStart(12, '0')}`;
    const archive = join(local.root, `${id}.tar.gz`);
    await writeFile(archive, tarGz(syntheticExport()));
    await extractExport(archive, await local.ensureDirectory(`imports/${id}/meetings`), {
      maxBytes: 1_000_000,
      maxEntries: 100,
    });
    const firefliesId = planning?.id ?? '';
    const [row] = await test.db
      .insert(meetings)
      .values({
        title: planning?.title ?? '',
        platform: 'imported',
        joinUrl: `https://app.fireflies.ai/view/${firefliesId}`,
        externalId: `fireflies:${firefliesId}:${id}`,
        status: 'ended',
        invitees: [{ email: 'alice@example.com', name: null, declined: false }],
      })
      .returning();
    return { meetingId: row?.id ?? '', uploadId: id, firefliesId };
  }

  const run = (job: Awaited<ReturnType<typeof stage>>) =>
    importMeeting(deps(), job satisfies ImportJobPayload);

  const load = async (meetingId: string) => {
    const [meeting] = await test.db.select().from(meetings).where(eq(meetings.id, meetingId));
    return {
      meeting,
      segments: await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.meetingId, meetingId))
        .orderBy(transcriptSegments.startMs),
      summaries: await test.db.select().from(summaries).where(eq(summaries.meetingId, meetingId)),
      audio: await test.db.select().from(audioFiles).where(eq(audioFiles.meetingId, meetingId)),
    };
  };

  it('stores the audio and hands the meeting to the normal processing', async () => {
    const job = await stage();
    await run(job);
    const { meeting, audio } = await load(job.meetingId);

    expect(meeting).toMatchObject({ status: 'ended', error: null });
    expect(meeting?.processingStep).toBeNull();
    expect(audio).toEqual([
      expect.objectContaining({
        path: `meetings/${job.meetingId}/recording.mp3`,
        codec: 'mp3',
        durationMs: 61_000,
      }),
    ]);
    expect(await local.exists(`meetings/${job.meetingId}/recording.mp3`)).toBe(true);
    expect(sent).toEqual([{ name: 'meeting.process', payload: { meetingId: job.meetingId } }]);
    expect(await readdir(local.absolutePath(`imports/${job.uploadId}/meetings`))).toEqual([
      klant?.id,
    ]);
  });

  it('never imports the Fireflies transcript or summary', async () => {
    const job = await stage();
    await run(job);
    const { segments, summaries: versions } = await load(job.meetingId);
    expect(segments).toEqual([]);
    expect(versions).toEqual([]);
  });

  it('leaves a meeting that is already past the import alone', async () => {
    const job = await stage();
    await run(job);
    await test.db
      .update(meetings)
      .set({ status: 'transcribed' })
      .where(eq(meetings.id, job.meetingId));
    await run(job);
    expect((await load(job.meetingId)).meeting?.status).toBe('transcribed');
    expect(sent).toHaveLength(1);
  });

  it('marks only this meeting as failed when its files are gone', async () => {
    const job = await stage();
    const other = await stage();
    await local.removeDirectory(`imports/${job.uploadId}`);
    await run(job);
    await run(other);

    expect((await load(job.meetingId)).meeting).toMatchObject({ status: 'failed' });
    expect((await load(job.meetingId)).meeting?.error).toContain('Import failed:');
    expect((await load(other.meetingId)).meeting?.status).toBe('ended');
  });

  it('ignores a failed meeting until it is queued again', async () => {
    const job = await stage();
    await test.db
      .update(meetings)
      .set({ status: 'failed', error: 'Import failed: boom' })
      .where(eq(meetings.id, job.meetingId));
    await run(job);
    expect((await load(job.meetingId)).meeting?.status).toBe('failed');
    await test.db
      .update(meetings)
      .set({ status: 'ended', error: null })
      .where(eq(meetings.id, job.meetingId));
    await run(job);
    expect((await load(job.meetingId)).meeting?.status).toBe('ended');
    expect(sent).toHaveLength(1);
  });
});
