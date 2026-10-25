import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  audioFiles,
  eq,
  meetingExports,
  meetings,
  shareLinks,
  summaries,
  transcriptSegments,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { meetingFolder, mergedAudioPath, originalAudioPath } from './audio-paths.js';
import { AudioStorage } from './audio-storage.js';
import {
  archiveMeetings,
  BIN_DAYS,
  binExpiry,
  binMeetings,
  isSettled,
  purgeExpiredBin,
  purgeMeetings,
  restoreMeetings,
  unarchiveMeetings,
} from './bin.js';
import { S3Storage } from './s3-storage.js';
import { LocalStorage } from './storage.js';
import { startFakeS3, type FakeS3 } from './testing/fake-s3.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe('archive and bin', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let local: LocalStorage;
  let storage: AudioStorage;
  let s3: FakeS3;

  async function insert(
    status: typeof meetings.$inferInsert.status = 'transcribed',
    extra: Partial<typeof meetings.$inferInsert> = {},
  ) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 't',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc',
        status,
        ...extra,
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    return meeting.id;
  }

  async function withContent(id: string) {
    const path = `meetings/${id}/000.opus`;
    await local.write(path, Buffer.from('audio'));
    await local.write(mergedAudioPath(id), Buffer.from('merged'));
    await local.write(originalAudioPath(id), Buffer.from('untrimmed'));
    await test.db
      .insert(audioFiles)
      .values({ meetingId: id, path, durationMs: 1000, codec: 'opus', size: 5 });
    await test.db
      .insert(transcriptSegments)
      .values({ meetingId: id, startMs: 0, endMs: 1000, text: 'words' });
    await test.db
      .insert(summaries)
      .values({ meetingId: id, provider: 'p', model: 'm', status: 'done', content: 'sum' });
    return path;
  }

  const row = async (id: string) =>
    (await test.db.select().from(meetings).where(eq(meetings.id, id)))[0];

  beforeAll(async () => {
    test = await createTestDatabase();
    s3 = await startFakeS3({ bucket: 'openminutes', accessKeyId: 'AKIATEST' });
  });
  afterAll(async () => {
    await test.close();
    await s3.close();
  });
  beforeEach(async () => {
    await test.db.delete(meetings);
    s3.objects.clear();
    local = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-bin-')));
    storage = new AudioStorage(local);
  });

  it('archives and unarchives a finished meeting', async () => {
    const id = await insert();
    expect(await archiveMeetings(test.db, [id], NOW)).toEqual([id]);
    expect((await row(id))?.archivedAt).toEqual(NOW);
    expect(await unarchiveMeetings(test.db, [id])).toEqual([id]);
    expect((await row(id))?.archivedAt).toBeNull();
  });

  it('never archives or bins a meeting that is running or upcoming', async () => {
    const future = new Date(NOW.getTime() + DAY_MS);
    const blocked = [
      await insert('recording'),
      await insert('processing'),
      await insert('uploading'),
      await insert('scheduled', { scheduledStart: future }),
      await insert('skipped', { scheduledStart: future }),
      await insert('skipped'),
    ];
    expect(await archiveMeetings(test.db, blocked, NOW)).toEqual([]);
    expect(await binMeetings(test.db, blocked, NOW)).toEqual([]);
    const past = await insert('skipped', { scheduledStart: daysAgo(1) });
    expect(await binMeetings(test.db, [past], NOW)).toEqual([past]);
  });

  it('agrees with the SQL rule in isSettled', () => {
    const future = new Date(NOW.getTime() + DAY_MS);
    expect(isSettled({ status: 'transcribed', scheduledStart: null }, NOW)).toBe(true);
    expect(isSettled({ status: 'failed', scheduledStart: null }, NOW)).toBe(true);
    expect(isSettled({ status: 'skipped', scheduledStart: daysAgo(1) }, NOW)).toBe(true);
    expect(isSettled({ status: 'skipped', scheduledStart: future }, NOW)).toBe(false);
    expect(isSettled({ status: 'skipped', scheduledStart: null }, NOW)).toBe(false);
    expect(isSettled({ status: 'scheduled', scheduledStart: daysAgo(1) }, NOW)).toBe(false);
    expect(isSettled({ status: 'recording', scheduledStart: null }, NOW)).toBe(false);
  });

  it('revokes share links the moment a meeting is binned', async () => {
    const id = await insert();
    await test.db.insert(shareLinks).values({ meetingId: id, token: 'a'.repeat(43) });
    await test.db
      .insert(meetingExports)
      .values({ meetingId: id, exporterId: 'share-link', ref: 'r', url: 'https://x' });
    await test.db
      .insert(meetingExports)
      .values({ meetingId: id, exporterId: 'google-docs', ref: 'r', url: 'https://x' });

    expect(await binMeetings(test.db, [id], NOW)).toEqual([id]);

    const [link] = await test.db.select().from(shareLinks).where(eq(shareLinks.meetingId, id));
    expect(link?.revokedAt).toEqual(NOW);
    const exports = await test.db
      .select()
      .from(meetingExports)
      .where(eq(meetingExports.meetingId, id));
    expect(exports.map((e) => e.exporterId)).toEqual(['google-docs']);
  });

  it('restores a binned meeting and keeps its archive state', async () => {
    const id = await insert();
    await archiveMeetings(test.db, [id], NOW);
    await binMeetings(test.db, [id], NOW);
    expect(await archiveMeetings(test.db, [id], NOW)).toEqual([]);
    expect(await restoreMeetings(test.db, [id])).toEqual([id]);
    const restored = await row(id);
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.archivedAt).toEqual(NOW);
  });

  it('purges only after 30 days in the bin, with everything it owns', async () => {
    const old = await insert();
    const path = await withContent(old);
    const fresh = await insert();
    await withContent(fresh);
    const live = await insert();
    await withContent(live);
    await test.db
      .update(meetings)
      .set({ deletedAt: daysAgo(BIN_DAYS + 1) })
      .where(eq(meetings.id, old));
    await test.db
      .update(meetings)
      .set({ deletedAt: daysAgo(BIN_DAYS - 1) })
      .where(eq(meetings.id, fresh));

    expect(await purgeExpiredBin({ db: test.db, storage, now: NOW })).toBe(1);

    expect(await row(old)).toBeUndefined();
    expect(await local.exists(path)).toBe(false);
    expect(await local.exists(mergedAudioPath(old))).toBe(false);
    expect(await local.exists(originalAudioPath(old))).toBe(false);
    expect(await local.exists(meetingFolder(old))).toBe(false);
    expect(
      await test.db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, old)),
    ).toEqual([]);
    expect(await test.db.select().from(summaries).where(eq(summaries.meetingId, old))).toEqual([]);
    expect(await row(fresh)).toBeDefined();
    expect(await row(live)).toBeDefined();
    expect(await local.exists(mergedAudioPath(fresh))).toBe(true);
    expect(await purgeExpiredBin({ db: test.db, storage, now: NOW })).toBe(0);
  });

  it('purges the exact day the thirty days are over', async () => {
    const id = await insert();
    await test.db
      .update(meetings)
      .set({ deletedAt: daysAgo(BIN_DAYS) })
      .where(eq(meetings.id, id));
    expect(binExpiry(daysAgo(BIN_DAYS))).toEqual(NOW);
    expect(await purgeExpiredBin({ db: test.db, storage, now: NOW })).toBe(1);
  });

  it('purges audio kept in the bucket too', async () => {
    const remote = new S3Storage({
      endpoint: s3.endpoint,
      bucket: 'openminutes',
      region: 'us-east-1',
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'shh',
    });
    const archived = new AudioStorage(local, remote);
    const id = await insert();
    s3.objects.set(mergedAudioPath(id), Buffer.from('archived'));
    s3.objects.set(originalAudioPath(id), Buffer.from('archived'));
    await binMeetings(test.db, [id], NOW);

    expect(await purgeMeetings({ db: test.db, storage: archived }, [id])).toEqual([id]);

    expect(s3.objects.has(mergedAudioPath(id))).toBe(false);
    expect(s3.objects.has(originalAudioPath(id))).toBe(false);
  });

  it('refuses to purge a meeting that is not in the bin', async () => {
    const id = await insert();
    expect(await purgeMeetings({ db: test.db, storage }, [id])).toEqual([]);
    expect(await row(id)).toBeDefined();
  });
});
