import { eq, meetings, type MeetingStatus } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  failStuckMeetings,
  HEARTBEAT_STALE_MS,
  JOIN_GRACE_MS,
  lobbyTimeoutMessage,
  PROCESSING_STALE_MS,
  RECORDING_GRACE_MS,
} from './watchdog.js';

const START = new Date('2026-10-22T12:00:00Z');
const limits = { lobbyTimeoutSeconds: 600, maxDurationMinutes: 60 };
const at = (ms: number) => new Date(START.getTime() + ms);
const MINUTE = 60_000;

describe('failStuckMeetings', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;

  async function insert(status: MeetingStatus, times: Partial<typeof meetings.$inferInsert>) {
    const [row] = await test.db
      .insert(meetings)
      .values({
        title: 't',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status,
        createdAt: START,
        ...times,
      })
      .returning();
    if (!row) throw new Error('insert failed');
    return row.id;
  }
  const row = async (id: string) =>
    (await test.db.select().from(meetings).where(eq(meetings.id, id)))[0];

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());
  beforeEach(async () => {
    await test.db.delete(meetings);
  });

  it('words the lobby timeout in minutes', () => {
    expect(lobbyTimeoutMessage(600)).toBe('Nobody admitted the bot within 10 minutes');
    expect(lobbyTimeoutMessage(60)).toBe('Nobody admitted the bot within 1 minute');
  });

  it('fails a meeting that waits in the lobby past the timeout and the grace period', async () => {
    const id = await insert('in_lobby', { claimedAt: START, heartbeatAt: at(0) });
    const deadline = limits.lobbyTimeoutSeconds * 1000 + JOIN_GRACE_MS;

    const early = at(deadline - 1000);
    await test.db.update(meetings).set({ heartbeatAt: early }).where(eq(meetings.id, id));
    expect(await failStuckMeetings(test.db, limits, early)).toEqual([]);

    const late = at(deadline + 1000);
    await test.db.update(meetings).set({ heartbeatAt: late }).where(eq(meetings.id, id));
    expect(await failStuckMeetings(test.db, limits, late)).toEqual([{ id, reason: 'lobby' }]);
    expect(await row(id)).toMatchObject({
      status: 'failed',
      error: 'Nobody admitted the bot within 10 minutes',
      endedAt: late,
    });
  });

  it('fails a recording whose bot stopped sending heartbeats', async () => {
    const stale = await insert('recording', { startedAt: START, heartbeatAt: START });
    const alive = await insert('recording', { startedAt: START, heartbeatAt: at(2 * MINUTE) });
    const now = at(HEARTBEAT_STALE_MS + 1000);
    await test.db
      .update(meetings)
      .set({ heartbeatAt: at(2 * MINUTE) })
      .where(eq(meetings.id, alive));

    expect(await failStuckMeetings(test.db, limits, now)).toEqual([
      { id: stale, reason: 'heartbeat' },
    ]);
    expect((await row(stale))?.error).toMatch(/stopped responding/);
    expect((await row(alive))?.status).toBe('recording');
  });

  it('treats an active meeting from before heartbeats existed as stale', async () => {
    const id = await insert('joining', {});
    expect(await failStuckMeetings(test.db, limits, at(HEARTBEAT_STALE_MS + 1000))).toEqual([
      { id, reason: 'heartbeat' },
    ]);
  });

  it('closes a recording that ran past the maximum duration even with a live heartbeat', async () => {
    const now = at(limits.maxDurationMinutes * MINUTE + RECORDING_GRACE_MS + 1000);
    const id = await insert('recording', { startedAt: START, heartbeatAt: now });

    expect(await failStuckMeetings(test.db, limits, now)).toEqual([{ id, reason: 'duration' }]);
    expect((await row(id))?.status).toBe('failed');
  });

  it('leaves healthy, finished and scheduled meetings alone', async () => {
    const now = at(2 * MINUTE);
    await insert('in_lobby', { claimedAt: START, heartbeatAt: now });
    await insert('recording', { startedAt: START, heartbeatAt: now });
    await insert('scheduled', {});
    await insert('transcribed', { endedAt: START });

    expect(await failStuckMeetings(test.db, limits, now)).toEqual([]);
  });

  it('fails each stuck meeting once', async () => {
    await insert('in_lobby', { claimedAt: START, heartbeatAt: START });
    const now = at(limits.lobbyTimeoutSeconds * 1000 + JOIN_GRACE_MS + 1000);

    expect(await failStuckMeetings(test.db, limits, now)).toHaveLength(1);
    expect(await failStuckMeetings(test.db, limits, now)).toEqual([]);
  });

  it('fails processing whose worker stopped reporting, and keeps one that reports', async () => {
    const dead = await insert('processing', { heartbeatAt: START });
    const alive = await insert('processing', { heartbeatAt: at(PROCESSING_STALE_MS) });
    const queued = await insert('processing', {}); // never reported, created long ago

    const failed = await failStuckMeetings(test.db, limits, at(PROCESSING_STALE_MS + 1000));

    expect(failed.map((f) => f.id).toSorted()).toEqual([dead, queued].toSorted());
    expect((await row(dead))?.error).toMatch(/Press Re-process/);
    expect((await row(alive))?.status).toBe('processing');
    expect((await row(queued))?.status).toBe('failed');
  });
});
