import {
  calendarAccounts,
  calendars,
  createDatabase,
  eq,
  meetings,
  meetingSources,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimSlot, failInterruptedMeetings } from './slots.js';

describe('meeting slots', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  async function insert(status: typeof meetings.$inferInsert.status) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 't', platform: 'meet', joinUrl: 'https://meet.google.com/abc', status })
      .returning();
    if (!meeting) throw new Error('insert failed');
    return meeting.id;
  }

  const statusOf = async (id: string) =>
    (await test.db.select().from(meetings).where(eq(meetings.id, id)))[0];

  it('never lets simultaneous claims go over the cap', async () => {
    await test.db.delete(meetings);
    const ids = await Promise.all(Array.from({ length: 6 }, () => insert('scheduled')));

    const claims = await Promise.all(ids.map((id) => claimSlot(test.db, id, 2)));

    expect(claims.filter((claim) => claim === 'claimed')).toHaveLength(2);
    const rows = await test.db.select().from(meetings);
    expect(rows.filter((m) => m.status === 'joining')).toHaveLength(2);
  });

  it('frees a slot when a meeting ends, and skips meetings that are no longer queued', async () => {
    await test.db.delete(meetings);
    const running = await insert('recording');
    const queued = await insert('scheduled');
    const cancelled = await insert('cancelled');

    expect(await claimSlot(test.db, queued, 1)).toBe('full');
    await test.db.update(meetings).set({ status: 'ended' }).where(eq(meetings.id, running));
    expect(await claimSlot(test.db, cancelled, 1)).toBe('gone');
    expect(await claimSlot(test.db, queued, 1)).toBe('claimed');
  });

  describe('making room when every slot is taken', () => {
    const NOW = new Date('2026-10-22T12:30:00Z');
    const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

    async function lobby(waitedMinutes: number, extra: Partial<typeof meetings.$inferInsert> = {}) {
      const [meeting] = await test.db
        .insert(meetings)
        .values({
          title: 't',
          platform: 'meet',
          joinUrl: 'https://meet.google.com/abc',
          status: 'in_lobby',
          claimedAt: minutesAgo(waitedMinutes),
          ...extra,
        })
        .returning();
      if (!meeting) throw new Error('insert failed');
      return meeting.id;
    }

    async function calendarSource(meetingId: string) {
      const [account] = await test.db
        .insert(calendarAccounts)
        .values({ provider: 'google', accountEmail: `${meetingId}@x.io`, encryptedTokens: 'x' })
        .returning();
      const [calendar] = await test.db
        .insert(calendars)
        .values({ accountId: account?.id ?? '', externalId: 'c', name: 'c' })
        .returning();
      await test.db.insert(meetingSources).values({
        meetingId,
        calendarId: calendar?.id ?? '',
        calendarEventId: 'e',
        joinable: true,
      });
    }

    it('sends away the bot that waited longest in a lobby and fails an ad hoc meeting', async () => {
      await test.db.delete(meetings);
      const longest = await lobby(8);
      const recent = await lobby(2);
      const incoming = await insert('scheduled');
      const requeued: string[] = [];

      expect(await claimSlot(test.db, incoming, 2, NOW, requeued)).toBe('claimed');

      expect(await statusOf(longest)).toMatchObject({
        status: 'failed',
        error: 'Made room for another meeting after waiting 8 minutes in the lobby',
      });
      expect((await statusOf(recent))?.status).toBe('in_lobby');
      expect((await statusOf(incoming))?.status).toBe('joining');
      expect(requeued).toEqual([]);
    });

    it('queues a calendar meeting again when its start is still ahead', async () => {
      await test.db.delete(meetings);
      await test.db.delete(calendarAccounts);
      const waiting = await lobby(5, { scheduledStart: new Date(NOW.getTime() + 20 * 60_000) });
      await calendarSource(waiting);
      const incoming = await insert('scheduled');
      const requeued: string[] = [];

      expect(await claimSlot(test.db, incoming, 1, NOW, requeued)).toBe('claimed');

      expect(await statusOf(waiting)).toMatchObject({ status: 'scheduled' });
      expect((await statusOf(waiting))?.error).toMatch(
        /^Made room for another meeting after waiting 5 minutes/,
      );
      expect(requeued).toEqual([waiting]);
    });

    it('fails a calendar meeting whose start already passed', async () => {
      await test.db.delete(meetings);
      await test.db.delete(calendarAccounts);
      const waiting = await lobby(5, { scheduledStart: minutesAgo(10) });
      await calendarSource(waiting);
      const incoming = await insert('scheduled');
      const requeued: string[] = [];

      await claimSlot(test.db, incoming, 1, NOW, requeued);

      expect((await statusOf(waiting))?.status).toBe('failed');
      expect(requeued).toEqual([]);
    });

    it('never sends away a bot that is joining, recording or admitted', async () => {
      await test.db.delete(meetings);
      const recording = await insert('recording');
      const joining = await insert('joining');
      const incoming = await insert('scheduled');

      expect(await claimSlot(test.db, incoming, 2, NOW)).toBe('full');

      expect((await statusOf(recording))?.status).toBe('recording');
      expect((await statusOf(joining))?.status).toBe('joining');
      expect((await statusOf(incoming))?.status).toBe('scheduled');
    });

    it('makes room only once when two meetings claim at the same time', async () => {
      await test.db.delete(meetings);
      await lobby(9);
      const first = await insert('scheduled');
      const second = await insert('scheduled');

      const claims = await Promise.all([
        claimSlot(test.db, first, 1, NOW),
        claimSlot(test.db, second, 1, NOW),
      ]);

      expect(claims.filter((claim) => claim === 'claimed')).toHaveLength(1);
      expect(claims.filter((claim) => claim === 'full')).toHaveLength(1);
      const rows = await test.db.select().from(meetings);
      expect(rows.filter((m) => m.status === 'joining')).toHaveLength(1);
    });
  });

  it('marks meetings left in progress by a crash as failed with a reason', async () => {
    await test.db.delete(meetings);
    const ids = {
      joining: await insert('joining'),
      lobby: await insert('in_lobby'),
      recording: await insert('recording'),
      queued: await insert('scheduled'),
      done: await insert('transcribed'),
    };

    expect(await failInterruptedMeetings(test.db)).toHaveLength(3);

    for (const id of [ids.joining, ids.lobby, ids.recording]) {
      const meeting = await statusOf(id);
      expect(meeting?.status).toBe('failed');
      expect(meeting?.error).toContain('bot stopped');
      expect(meeting?.endedAt).toBeInstanceOf(Date);
    }
    expect((await statusOf(ids.queued))?.status).toBe('scheduled');
    expect((await statusOf(ids.done))?.status).toBe('transcribed');
    expect(await failInterruptedMeetings(test.db)).toEqual([]);
  });

  describe('duplicate links', () => {
    const key = 'meet:abc-defg-hij';

    async function insertKeyed(
      values: Partial<typeof meetings.$inferInsert> = {},
      joinKey: string | null = key,
    ) {
      const [meeting] = await test.db
        .insert(meetings)
        .values({
          title: `t-${Math.random()}`,
          platform: 'meet',
          joinUrl: 'https://meet.google.com/abc-defg-hij',
          joinKey,
          scheduledStart: new Date(Date.now() + Math.floor(Math.random() * 1e9)),
          ...values,
        })
        .returning();
      if (!meeting) throw new Error('insert failed');
      return meeting.id;
    }

    it('lets only one of two workers join when two entries share a link', async () => {
      await test.db.delete(meetings);
      const ids = [await insertKeyed(), await insertKeyed(), await insertKeyed()];
      const workers = [createDatabase(test.url), createDatabase(test.url)];
      try {
        const claims = await Promise.all(
          ids.map((id, i) => claimSlot(workers[i % 2]?.db ?? test.db, id, 10)),
        );
        expect(claims.filter((claim) => claim === 'claimed')).toHaveLength(1);
        expect(claims.filter((claim) => claim === 'duplicate')).toHaveLength(2);
        const rows = await test.db.select().from(meetings);
        expect(rows.filter((m) => m.status === 'joining')).toHaveLength(1);
        const skipped = rows.filter((m) => m.status === 'cancelled');
        expect(skipped).toHaveLength(2);
        expect(skipped[0]?.error).toMatch(/already joined this link/);
      } finally {
        await Promise.all(workers.map((worker) => worker.pool.end()));
      }
    });

    it('skips a link that was joined in the last minutes but not an older one', async () => {
      await test.db.delete(meetings);
      await insertKeyed({ status: 'ended', startedAt: new Date(Date.now() - 4 * 60_000) });
      const recent = await insertKeyed();
      expect(await claimSlot(test.db, recent, 10)).toBe('duplicate');

      await test.db.delete(meetings);
      await insertKeyed({ status: 'ended', startedAt: new Date(Date.now() - 2 * 3_600_000) });
      const later = await insertKeyed();
      expect(await claimSlot(test.db, later, 10)).toBe('claimed');
    });

    it('joins anyway when forced, and ignores other links and legacy rows without a key', async () => {
      await test.db.delete(meetings);
      await insertKeyed({ status: 'recording' });
      const forced = await insertKeyed({ allowDuplicate: true });
      const other = await insertKeyed({}, 'meet:xyz-wxyz-xyz');
      const legacy = await insertKeyed({}, null);

      expect(await claimSlot(test.db, forced, 10)).toBe('claimed');
      expect(await claimSlot(test.db, other, 10)).toBe('claimed');
      expect(await claimSlot(test.db, legacy, 10)).toBe('claimed');
    });
  });
});
