import { eq, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { JobName, JobPayloads } from './jobs.js';
import { eq as same, skippedSeries } from '@openminutes/db';
import { rejoinMeeting, rejoinSeries, skipMeeting, skipSeries } from './skip.js';

const NOW = new Date('2026-10-22T12:00:00Z');
const HOUR = 3_600_000;

describe('skipping a meeting', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  const sent: { name: JobName; payload: JobPayloads[JobName] }[] = [];
  const queue = {
    send: (name: JobName, payload: JobPayloads[JobName]) => {
      sent.push({ name, payload });
      return Promise.resolve();
    },
  };
  const deps = () => ({ db: test.db, queue, now: () => NOW });

  async function insert(
    status: 'scheduled' | 'recording' | 'skipped',
    startOffsetHours: number | null,
  ) {
    const [row] = await test.db
      .insert(meetings)
      .values({
        title: 't',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status,
        scheduledStart:
          startOffsetHours === null ? null : new Date(NOW.getTime() + startOffsetHours * HOUR),
      })
      .returning();
    if (!row) throw new Error('insert failed');
    return row.id;
  }
  const statusOf = async (id: string) =>
    (await test.db.select().from(meetings).where(eq(meetings.id, id)))[0]?.status;

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());
  beforeEach(async () => {
    sent.length = 0;
    await test.db.delete(meetings);
  });

  it('skips a scheduled meeting only', async () => {
    const scheduled = await insert('scheduled', 2);
    const recording = await insert('recording', -1);

    expect(await skipMeeting(test.db, scheduled)).toBe('skipped');
    expect(await statusOf(scheduled)).toBe('skipped');
    expect(await skipMeeting(test.db, recording)).toBe('not_skippable');
    expect(await statusOf(recording)).toBe('recording');
    expect(await skipMeeting(test.db, crypto.randomUUID())).toBe('not_found');
  });

  it('joins again and schedules the join while the start is ahead', async () => {
    const id = await insert('skipped', 2);

    expect(await rejoinMeeting(deps(), id)).toBe('rescheduled');
    expect(await statusOf(id)).toBe('scheduled');
    expect(sent).toEqual([{ name: 'meeting.schedule', payload: { meetingId: id } }]);
  });

  it('joins again an ad hoc meeting without a start', async () => {
    const id = await insert('skipped', null);
    expect(await rejoinMeeting(deps(), id)).toBe('rescheduled');
  });

  it('does not rejoin a meeting that already started or was not skipped', async () => {
    const past = await insert('skipped', -1);
    const scheduled = await insert('scheduled', 2);

    expect(await rejoinMeeting(deps(), past)).toBe('already_started');
    expect(await statusOf(past)).toBe('skipped');
    expect(await rejoinMeeting(deps(), scheduled)).toBe('not_skipped');
    expect(await rejoinMeeting(deps(), crypto.randomUUID())).toBe('not_found');
    expect(sent).toEqual([]);
  });

  describe('a recurring series', () => {
    async function occurrence(seriesKey: string | null, startOffsetHours: number) {
      const id = await insert('scheduled', startOffsetHours);
      await test.db.update(meetings).set({ seriesKey }).where(eq(meetings.id, id));
      return id;
    }

    it('skips the upcoming occurrences and remembers the series', async () => {
      const next = await occurrence('google:weekly', 2);
      const later = await occurrence('google:weekly', 170);
      const other = await occurrence('google:other', 3);
      const past = await occurrence('google:weekly', -2);

      expect(await skipSeries({ db: test.db, now: () => NOW }, next)).toBe('changed');

      expect(await statusOf(next)).toBe('skipped');
      expect(await statusOf(later)).toBe('skipped');
      expect(await statusOf(other)).toBe('scheduled');
      expect(await statusOf(past)).toBe('scheduled');
      expect(await test.db.select().from(skippedSeries)).toHaveLength(1);
    });

    it('refuses a meeting without a series and an unknown meeting', async () => {
      const single = await occurrence(null, 2);
      expect(await skipSeries({ db: test.db }, single)).toBe('no_series');
      expect(await skipSeries({ db: test.db }, crypto.randomUUID())).toBe('not_found');
    });

    it('joins the series again and schedules the skipped occurrences ahead', async () => {
      const next = await occurrence('google:weekly', 2);
      await skipSeries({ db: test.db, now: () => NOW }, next);
      const [series] = await test.db.select().from(skippedSeries);
      sent.length = 0;

      expect(await rejoinSeries(deps(), series?.id ?? '')).toBe('changed');

      expect(await statusOf(next)).toBe('scheduled');
      expect(sent).toEqual([{ name: 'meeting.schedule', payload: { meetingId: next } }]);
      expect(
        await test.db
          .select()
          .from(skippedSeries)
          .where(same(skippedSeries.id, series?.id ?? '')),
      ).toEqual([]);
      expect(await rejoinSeries(deps(), series?.id ?? '')).toBe('not_found');
    });
  });
});
