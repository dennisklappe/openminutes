import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MeetingListItemDto, UpcomingMeetingsDto } from '../dto.js';
import { meetingRoutes } from './routes.js';

describe('upcoming meetings', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

  beforeAll(async () => {
    test = await createTestDatabase();
    const storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-upcoming-')));
    app = new Hono().route(
      '/meetings',
      meetingRoutes({
        db: test.db,
        queue: { send: () => Promise.resolve() },
        storage,
        settings: new SettingsStore(test.db, 'a-long-enough-test-secret'),
      }),
    );
    const base = { platform: 'meet', joinUrl: 'https://meet.google.com/abc-defg-hij' } as const;
    await test.db.insert(meetings).values([
      ...Array.from({ length: 12 }, (_, i) => ({
        ...base,
        title: `Soon ${String(i).padStart(2, '0')}`,
        status: 'scheduled' as const,
        scheduledStart: hours(i + 1),
      })),
      { ...base, title: 'Skipped soon', status: 'skipped', scheduledStart: hours(0.5) },
      { ...base, title: 'Two weeks out', status: 'scheduled', scheduledStart: hours(14 * 24) },
      { ...base, title: 'Next quarter', status: 'scheduled', scheduledStart: hours(90 * 24) },
      { ...base, title: 'Skipped and past', status: 'skipped', scheduledStart: hours(-5) },
      { ...base, title: 'Done', status: 'transcribed', startedAt: hours(-30) },
    ]);
  });
  afterAll(() => test.close());

  const upcoming = async (query = '') =>
    (await (await app.request(`/meetings/upcoming${query}`)).json()) as UpcomingMeetingsDto;

  it('defaults to the next 7 days, at most 10, skipped ones included', async () => {
    const result = await upcoming();
    expect(result.items).toHaveLength(10);
    expect(result.items[0]?.title).toBe('Skipped soon');
    expect(result.items.map((m) => m.title)).not.toContain('Two weeks out');
    expect(result.total).toBe(13);
    expect(result.all).toBe(15);
  });

  it('extends the window and the cap, up to 30 days and 20 meetings', async () => {
    const result = await upcoming('?days=30&limit=20');
    expect(result.items).toHaveLength(14);
    expect(result.items.at(-1)?.title).toBe('Two weeks out');
    expect(result.total).toBe(14);
    expect(result.all).toBe(15);
  });

  it('refuses a window or limit beyond the maximum', async () => {
    expect((await app.request('/meetings/upcoming?limit=21')).status).toBe(400);
    expect((await app.request('/meetings/upcoming?days=31')).status).toBe(400);
  });

  it('leaves upcoming meetings out of the plain list on request only', async () => {
    const titles = async (query: string) =>
      ((await (await app.request(`/meetings${query}`)).json()) as MeetingListItemDto[]).map(
        (m) => m.title,
      );
    expect(await titles('?upcoming=hide')).toEqual(
      expect.arrayContaining(['Done', 'Skipped and past']),
    );
    expect(await titles('?upcoming=hide')).toHaveLength(2);
    expect(await titles('')).toHaveLength(17);
  });
});
