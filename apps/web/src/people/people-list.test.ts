import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { eq, meetings, participants, people } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { PeopleDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('the paged people list', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let cookie = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-people-list-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
    });
    const created = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    cookie = created.headers.get('set-cookie')?.split(';')[0] ?? '';

    const day = (n: number) => new Date(Date.UTC(2026, 0, n));
    const rows = await test.db
      .insert(meetings)
      .values(
        [1, 2, 3].map((n) => ({
          title: `Synthetic ${String(n)}`,
          platform: 'meet' as const,
          joinUrl: `https://meet.google.com/synthetic-${String(n)}`,
          startedAt: day(n),
          invitees:
            n === 3 ? [{ email: 'zed@example.com', name: 'Zed Invited', declined: false }] : null,
        })),
      )
      .returning();
    const [m1, m2, m3] = rows.toSorted((a, b) => a.title.localeCompare(b.title));
    if (!m1 || !m2 || !m3) throw new Error('insert failed');
    await test.db.insert(participants).values([
      { meetingId: m1.id, displayName: 'Ada Synthetic', email: 'ada@example.com' },
      { meetingId: m2.id, displayName: 'Ada Synthetic' },
      { meetingId: m2.id, displayName: 'Bea Fixture' },
      { meetingId: m3.id, displayName: 'Bea Fixture' },
      { meetingId: m3.id, displayName: 'Cy Roman', email: 'cy@example.com' },
      { meetingId: m3.id, displayName: 'Fathom', isBot: true },
    ]);
    const scan = await app.request('/api/people/backfill', {
      method: 'POST',
      headers: { ...json, cookie },
    });
    expect(scan.status).toBe(200);
  });
  afterAll(() => test.close());

  const list = async (query = '') =>
    (await (await app.request(`/api/people${query}`, { headers: { cookie } })).json()) as PeopleDto;

  it('lists everyone with meeting counts and last seen, sorted by name', async () => {
    const result = await list();
    expect(result.total).toBe(4);
    expect(result.people.map((p) => [p.name, p.meetings, p.source])).toEqual([
      ['Ada Synthetic', 2, 'joined'],
      ['Bea Fixture', 2, 'joined'],
      ['Cy Roman', 1, 'joined'],
      ['Zed Invited', 1, 'invited'],
    ]);
    expect(result.people[0]?.lastSeenAt).toBe('2026-01-02T00:00:00.000Z');
    expect(result.people[0]?.emails).toEqual(['ada@example.com']);
  });

  it('sorts by meetings and by last seen, newest first when asked', async () => {
    const byMeetings = await list('?sort=meetings&dir=desc');
    expect(byMeetings.people.map((p) => p.meetings)).toEqual([2, 2, 1, 1]);
    const bySeen = await list('?sort=lastSeen&dir=desc');
    expect(bySeen.people.map((p) => p.name)).toEqual([
      'Bea Fixture',
      'Cy Roman',
      'Zed Invited',
      'Ada Synthetic',
    ]);
  });

  it('searches names and emails and filters by source on the server', async () => {
    expect((await list('?q=ROMAN')).people.map((p) => p.name)).toEqual(['Cy Roman']);
    expect((await list('?q=ada@example')).total).toBe(1);
    expect((await list('?q=100%25')).total).toBe(0);
    expect((await list('?source=invited')).people.map((p) => p.name)).toEqual(['Zed Invited']);
    expect((await list('?source=joined')).total).toBe(3);
  });

  it('counts an invited person who spoke in a meeting as joined', async () => {
    const [meeting] = await test.db.select().from(meetings).limit(1);
    const [who] = await test.db
      .insert(people)
      .values({ name: 'Dee Spoke', emails: ['dee@example.com'], source: 'invited' })
      .returning();
    if (!meeting || !who) throw new Error('insert failed');
    await test.db
      .insert(participants)
      .values({ meetingId: meeting.id, displayName: 'Dee Spoke', personId: who.id });
    expect((await list('?source=joined')).people.map((p) => p.name)).toContain('Dee Spoke');
    expect((await list('?source=invited')).people.map((p) => p.name)).not.toContain('Dee Spoke');
    expect((await list()).people.find((p) => p.name === 'Dee Spoke')?.source).toBe('joined');
    await test.db.delete(participants).where(eq(participants.personId, who.id));
    await test.db.delete(people).where(eq(people.id, who.id));
  });

  it('pages and rejects a bad query', async () => {
    const second = await list('?pageSize=3&page=2');
    expect(second).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(second.people.map((p) => p.name)).toEqual(['Zed Invited']);
    expect((await list('?page=9&pageSize=3')).people).toEqual([]);
    const bad = await app.request('/api/people?sort=nope', { headers: { cookie } });
    expect(bad.status).toBe(400);
  });

  it('scanning again changes nothing', async () => {
    const before = await test.db.select().from(people);
    await app.request('/api/people/backfill', { method: 'POST', headers: { ...json, cookie } });
    expect(await test.db.select().from(people)).toHaveLength(before.length);
  });
});
