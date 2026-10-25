import { eq, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JobName, JobPayloads } from './jobs.js';
import { createMeeting, DuplicateMeetingError, UnsupportedMeetingUrlError } from './meetings.js';

describe('createMeeting', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  const sent: { name: JobName; payload: JobPayloads[JobName] }[] = [];
  const queue = {
    send: (name: JobName, payload: JobPayloads[JobName]) => {
      sent.push({ name, payload });
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  it('stores the meeting and queues the schedule job', async () => {
    const meeting = await createMeeting(
      { db: test.db, queue },
      { url: ' https://meet.google.com/abc-defg-hij ' },
    );

    expect(meeting).toMatchObject({
      platform: 'meet',
      joinUrl: 'https://meet.google.com/abc-defg-hij',
      title: 'Google Meet abc-defg-hij',
      status: 'scheduled',
    });
    expect(sent).toEqual([{ name: 'meeting.schedule', payload: { meetingId: meeting.id } }]);
    expect(await test.db.select().from(meetings)).toHaveLength(1);
  });

  it('stores the canonical link and a clean title for a /meet/ link', async () => {
    const meeting = await createMeeting(
      { db: test.db, queue },
      { url: 'meet.google.com/meet/EYV-UMAH-WYH?authuser=2' },
    );

    expect(meeting).toMatchObject({
      joinUrl: 'https://meet.google.com/eyv-umah-wyh',
      joinKey: 'meet:eyv-umah-wyh',
      title: 'Google Meet eyv-umah-wyh',
    });
  });

  it('rejects links from unsupported platforms without side effects', async () => {
    sent.length = 0;
    await expect(
      createMeeting({ db: test.db, queue }, { url: 'https://zoom.us/j/1' }),
    ).rejects.toBeInstanceOf(UnsupportedMeetingUrlError);
    expect(sent).toEqual([]);
    expect(await test.db.select().from(meetings)).toHaveLength(2);
  });

  describe('duplicate links', () => {
    const url = 'https://meet.google.com/dup-lica-ten';
    const variant = 'https://meet.google.com/dup-lica-ten?authuser=3';

    async function existing(status: typeof meetings.$inferInsert.status, startedAt?: Date) {
      await test.db.delete(meetings);
      const meeting = await createMeeting({ db: test.db, queue }, { url });
      await test.db
        .update(meetings)
        .set({ status, ...(startedAt && { startedAt }) })
        .where(eq(meetings.id, meeting.id));
      return meeting;
    }

    it.each(['joining', 'in_lobby', 'recording'] as const)(
      'refuses a link the bot is already in (%s)',
      async (status) => {
        const first = await existing(status);
        const error = await createMeeting({ db: test.db, queue }, { url: variant }).catch(
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(DuplicateMeetingError);
        expect((error as DuplicateMeetingError).existing.id).toBe(first.id);
        expect((error as Error).message).toContain('already in this meeting');
        expect(await test.db.select().from(meetings)).toHaveLength(1);
      },
    );

    it('refuses a link joined a few minutes ago but not one joined long ago', async () => {
      await existing('ended', new Date(Date.now() - 5 * 60_000));
      await expect(createMeeting({ db: test.db, queue }, { url: variant })).rejects.toThrow(
        /joined this meeting/,
      );

      await existing('ended', new Date(Date.now() - 60 * 60_000));
      await expect(createMeeting({ db: test.db, queue }, { url: variant })).resolves.toMatchObject({
        status: 'scheduled',
      });
    });

    it('allows a queued meeting for the same link and lets the user force it', async () => {
      await existing('scheduled');
      await expect(createMeeting({ db: test.db, queue }, { url })).resolves.toBeDefined();

      await existing('recording');
      const forced = await createMeeting({ db: test.db, queue }, { url, force: true });
      expect(forced).toMatchObject({ allowDuplicate: true, joinKey: 'meet:dup-lica-ten' });
    });
  });
});
