import { SettingsStore, type JobName, type JobPayloads, type SendOptions } from '@openminutes/core';
import { eq, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scheduleMeeting } from './schedule.js';

describe('scheduleMeeting', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  const sent: { name: JobName; payload: JobPayloads[JobName]; options?: SendOptions }[] = [];
  const queue = {
    send: (name: JobName, payload: JobPayloads[JobName], options?: SendOptions) => {
      sent.push({ name, payload, ...(options && { options }) });
      return Promise.resolve();
    },
  };
  const now = new Date('2026-01-01T10:00:00Z');

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  async function insert(values: Partial<typeof meetings.$inferInsert> = {}) {
    const [row] = await test.db
      .insert(meetings)
      .values({
        title: 't',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        ...values,
      })
      .returning();
    if (!row) throw new Error('insert failed');
    return row.id;
  }
  const run = (meetingId: string) =>
    scheduleMeeting({ db: test.db, queue, settings, now: () => now }, meetingId);

  it('joins immediately when there is no start time', async () => {
    sent.length = 0;
    const meetingId = await insert();
    await run(meetingId);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      name: 'meeting.join',
      payload: { meetingId, scheduledStart: null },
    });
    expect(sent[0]?.options?.startAfter).toBeUndefined();
    expect(sent[0]?.options?.expireInSeconds).toBe(600 + 240 * 60 + 600);
  });

  it('joins one minute before a future start', async () => {
    sent.length = 0;
    const meetingId = await insert({ scheduledStart: new Date('2026-01-01T11:00:00Z') });
    await run(meetingId);
    expect(sent[0]?.options?.startAfter).toEqual(new Date('2026-01-01T10:59:00Z'));
    expect(sent[0]?.payload).toEqual({ meetingId, scheduledStart: '2026-01-01T11:00:00.000Z' });
  });

  it('joins immediately when the start has passed', async () => {
    sent.length = 0;
    await run(await insert({ scheduledStart: new Date('2026-01-01T09:00:00Z') }));
    expect(sent[0]?.options?.startAfter).toBeUndefined();
  });

  it('ignores meetings that are not scheduled anymore', async () => {
    sent.length = 0;
    const meetingId = await insert();
    await test.db.update(meetings).set({ status: 'ended' }).where(eq(meetings.id, meetingId));
    await run(meetingId);
    await run('00000000-0000-0000-0000-000000000000');
    expect(sent).toEqual([]);
  });
});
