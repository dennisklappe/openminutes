import { eq, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { limitFor, Run } from './run-progress.js';

describe('Run', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());
  afterEach(() => {
    vi.useRealTimers();
  });

  async function processing() {
    const [row] = await test.db
      .insert(meetings)
      .values({ title: 't', platform: 'recording', joinUrl: 'phone://x', status: 'processing' })
      .returning();
    if (!row) throw new Error('insert failed');
    return row.id;
  }
  const load = async (id: string) =>
    (await test.db.select().from(meetings).where(eq(meetings.id, id)))[0];

  it('reports the step and clears it when finished', async () => {
    const id = await processing();
    const run = new Run(test.db, id);
    await run.begin();
    await run.step('transcribing', 2, 5);

    expect(await load(id)).toMatchObject({
      processingStep: 'transcribing',
      processingCurrent: 2,
      processingTotal: 5,
    });
    expect((await load(id))?.processingStartedAt).toBeInstanceOf(Date);
    expect((await load(id))?.heartbeatAt).toBeInstanceOf(Date);

    await run.finish();
    expect(await load(id)).toMatchObject({ processingStep: null, processingTotal: null });
  });

  it('aborts when the meeting is no longer processing, as after Cancel', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const id = await processing();
    const run = new Run(test.db, id);
    await test.db.update(meetings).set({ status: 'failed' }).where(eq(meetings.id, id));

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.waitFor(() => {
      expect(run.wasCancelled).toBe(true);
    });

    expect(run.wasCancelled).toBe(true);
    expect(run.signal.aborted).toBe(true);
    await expect(run.step('saving')).rejects.toThrow('cancelled');
    run.stop();
  });

  it('aborts a run that outlives its limit', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const run = new Run(test.db, await processing());
    run.limit(60 * 60_000);

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(run.wasCancelled).toBe(false);
    expect((run.signal.reason as Error).message).toBe('Processing took longer than 60 minutes');
    run.stop();
  });

  it('allows half an hour plus four times the recording', () => {
    expect(limitFor(60 * 60_000)).toBe(30 * 60_000 + 4 * 60 * 60_000);
  });
});
