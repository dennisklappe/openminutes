import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobQueue } from './queue.js';

describe('JobQueue', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let queue: JobQueue;

  beforeAll(async () => {
    test = await createTestDatabase();
    queue = await JobQueue.start(test.url);
  });
  afterAll(async () => {
    await queue.stop();
    await test.close();
  });

  it('delivers a sent job to its worker', async () => {
    const received = new Promise((resolve) => {
      void queue.work('meeting.process', (payload) => {
        resolve(payload);
        return Promise.resolve();
      });
    });
    await queue.send('meeting.process', { meetingId: 'm1' });
    expect(await received).toEqual({ meetingId: 'm1' });
  });

  it('lets processing run for hours instead of the 15 minute default', async () => {
    await queue.send('meeting.process', { meetingId: 'm2' });
    const { rows } = await test.pool.query<{ expire_seconds: number; retry_limit: number }>(
      "select expire_seconds, retry_limit from pgboss.queue where name = 'meeting.process'",
    );
    expect(rows[0]).toMatchObject({ expire_seconds: 6 * 3600, retry_limit: 1 });
  });
});
