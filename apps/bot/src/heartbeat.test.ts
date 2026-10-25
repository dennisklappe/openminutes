import { eq, meetings, type MeetingStatus } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { beat, startHeartbeat } from './heartbeat.js';

describe('heartbeat', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;

  const claimedAt = new Date('2026-10-22T12:00:00Z');

  async function insert(status: MeetingStatus) {
    const [row] = await test.db
      .insert(meetings)
      .values({
        claimedAt,
        title: 't',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status,
      })
      .returning();
    if (!row) throw new Error('insert failed');
    return row.id;
  }
  const heartbeatOf = async (id: string) =>
    (await test.db.select().from(meetings).where(eq(meetings.id, id)))[0]?.heartbeatAt;

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records the time for an active meeting and reports it alive', async () => {
    const id = await insert('in_lobby');
    const now = new Date('2026-10-22T12:00:00Z');

    expect(await beat(test.db, id, claimedAt, now)).toBe(true);
    expect(await heartbeatOf(id)).toEqual(now);
  });

  it('reports a meeting the worker already failed as lost and leaves it untouched', async () => {
    const id = await insert('failed');

    expect(await beat(test.db, id, claimedAt)).toBe(false);
    expect(await heartbeatOf(id)).toBeNull();
  });

  it('reports lost when the meeting was claimed again by a newer session', async () => {
    const id = await insert('joining');
    await test.db
      .update(meetings)
      .set({ claimedAt: new Date('2026-10-22T12:05:00Z') })
      .where(eq(meetings.id, id));

    expect(await beat(test.db, id, claimedAt)).toBe(false);
  });

  it('beats on every tick and calls onLost once the meeting is closed from outside', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const id = await insert('recording');
    const lost = vi.fn();
    const stop = startHeartbeat(test.db, id, claimedAt, lost, 1000);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(async () => {
      expect(await heartbeatOf(id)).not.toBeNull();
    });
    expect(lost).not.toHaveBeenCalled();

    await test.db.update(meetings).set({ status: 'failed' }).where(eq(meetings.id, id));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(lost).toHaveBeenCalledTimes(1);
    });
    stop();
  });
});
