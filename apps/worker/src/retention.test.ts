import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalStorage,
  meetingFolder,
  mergedAudioPath,
  originalAudioPath,
  saveStorage,
  SettingsStore,
} from '@openminutes/core';
import { startFakeS3, type FakeS3 } from '@openminutes/core/testing';
import { audioFiles, eq, meetings, summaries, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteExpiredAudio } from './retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T12:00:00Z');

describe('deleteExpiredAudio', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let local: LocalStorage;
  let settings: SettingsStore;
  let s3: FakeS3;

  const run = () => deleteExpiredAudio({ db: test.db, settings, local, now: () => NOW });

  async function insertMeeting(endedDaysAgo: number | null, status: 'transcribed' | 'processing') {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 't',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc',
        status,
        endedAt: endedDaysAgo === null ? null : new Date(NOW.getTime() - endedDaysAgo * DAY_MS),
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const path = `meetings/${meeting.id}/000.opus`;
    await local.write(path, Buffer.from('audio'));
    await local.write(mergedAudioPath(meeting.id), Buffer.from('merged'));
    await local.write(originalAudioPath(meeting.id), Buffer.from('untrimmed'));
    await test.db
      .insert(audioFiles)
      .values({ meetingId: meeting.id, path, durationMs: 1000, codec: 'opus', size: 5 });
    await test.db
      .insert(transcriptSegments)
      .values({ meetingId: meeting.id, startMs: 0, endMs: 1000, text: 'kept words' });
    await test.db.insert(summaries).values({
      meetingId: meeting.id,
      provider: 'p',
      model: 'm',
      status: 'done',
      content: 'kept',
    });
    return { id: meeting.id, path };
  }

  const reload = async (id: string) => {
    const [meeting] = await test.db.select().from(meetings).where(eq(meetings.id, id));
    return meeting;
  };
  const audioRows = async (id: string) =>
    (await test.db.select().from(audioFiles).where(eq(audioFiles.meetingId, id))).length;

  beforeAll(async () => {
    test = await createTestDatabase();
    local = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-retention-')));
    settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
    s3 = await startFakeS3({ bucket: 'openminutes', accessKeyId: 'AKIATEST' });
  });
  afterAll(async () => {
    await test.close();
    await s3.close();
  });

  it('does nothing while retention is off', async () => {
    const old = await insertMeeting(400, 'transcribed');
    expect(await run()).toBe(0);
    expect(await local.exists(old.path)).toBe(true);
  });

  it('deletes only the audio of meetings older than the limit', async () => {
    await settings.set('retention.audio_days', '30');
    const old = await insertMeeting(31, 'transcribed');
    const recent = await insertMeeting(29, 'transcribed');
    const running = await insertMeeting(90, 'processing');
    const open = await insertMeeting(null, 'transcribed');

    expect(await run()).toBe(2);

    expect(await local.exists(old.path)).toBe(false);
    expect(await local.exists(mergedAudioPath(old.id))).toBe(false);
    expect(await local.exists(originalAudioPath(old.id))).toBe(false);
    expect(await local.exists(meetingFolder(old.id))).toBe(false);
    expect(await audioRows(old.id)).toBe(0);
    expect((await reload(old.id))?.audioDeletedAt).toEqual(NOW);
    expect(
      (
        await test.db
          .select()
          .from(transcriptSegments)
          .where(eq(transcriptSegments.meetingId, old.id))
      ).length,
    ).toBe(1);
    expect(
      (await test.db.select().from(summaries).where(eq(summaries.meetingId, old.id))).length,
    ).toBe(1);

    for (const kept of [recent, running, open]) {
      expect(await local.exists(kept.path)).toBe(true);
      expect(await audioRows(kept.id)).toBe(1);
      expect((await reload(kept.id))?.audioDeletedAt).toBeNull();
    }
  });

  it('is idempotent', async () => {
    expect(await run()).toBe(0);
  });

  it('also deletes archived audio from the bucket', async () => {
    await saveStorage(settings, 's3', {
      endpoint: s3.endpoint,
      bucket: 'openminutes',
      region: 'us-east-1',
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'shh',
    });
    const old = await insertMeeting(60, 'transcribed');
    s3.objects.set(old.path, Buffer.from('archived'));
    s3.objects.set(mergedAudioPath(old.id), Buffer.from('archived'));
    s3.objects.set(originalAudioPath(old.id), Buffer.from('archived'));

    expect(await run()).toBe(1);

    expect(s3.objects.has(old.path)).toBe(false);
    expect(s3.objects.has(mergedAudioPath(old.id))).toBe(false);
    expect(s3.objects.has(originalAudioPath(old.id))).toBe(false);
    expect(await local.exists(old.path)).toBe(false);
  });
});
