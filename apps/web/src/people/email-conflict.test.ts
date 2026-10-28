import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { eq, meetings, participants, people } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { EmailConflictDto, PersonDetailDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('an address that another person has', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let cookie = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-conflict-'))),
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
  });
  afterAll(() => test.close());
  beforeEach(async () => {
    await test.db.delete(people);
  });

  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...json, cookie },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  async function pair() {
    const [jo, ann] = await test.db
      .insert(people)
      .values([
        { name: 'Jo Parker', emails: [], notes: 'Met at the fair' },
        {
          name: 'Ann Lee',
          emails: ['jo@parker.example', 'ann@acme.example'],
          source: 'invited',
          notes: 'Likes tea',
        },
      ])
      .returning();
    if (!jo || !ann) throw new Error('insert failed');
    return { jo, ann };
  }

  it('answers 409 with who has the address and who would keep their name', async () => {
    const { jo, ann } = await pair();
    const response = await call('PATCH', `/people/${jo.id}`, { emails: ['jo@parker.example'] });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'jo@parker.example already belongs to Ann Lee',
      code: 'email_taken',
      conflict: {
        email: 'jo@parker.example',
        personId: ann.id,
        name: 'Ann Lee',
        unnamed: false,
        source: 'invited',
        into: { id: jo.id, name: 'Jo Parker' },
      } satisfies EmailConflictDto,
    });
  });

  it('merges the other person in and saves the same input in one go', async () => {
    const { jo, ann } = await pair();
    const response = await call('PATCH', `/people/${jo.id}`, {
      emails: ['jo@parker.example'],
      mergeFrom: ann.id,
    });
    expect(response.status).toBe(200);
    const { person } = (await response.json()) as PersonDetailDto;
    expect(person).toMatchObject({
      id: jo.id,
      name: 'Jo Parker',
      emails: ['jo@parker.example', 'ann@acme.example'],
      notes: 'Met at the fair\n\nLikes tea',
    });
    expect(await test.db.select().from(people).where(eq(people.id, ann.id))).toEqual([]);
  });

  it('does not merge when the save still fails', async () => {
    const { jo, ann } = await pair();
    await test.db.insert(people).values({ name: 'Kim Roe', emails: ['kim@roe.example'] });
    const response = await call('PATCH', `/people/${jo.id}`, {
      emails: ['jo@parker.example', 'kim@roe.example'],
      mergeFrom: ann.id,
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { conflict: EmailConflictDto }).conflict.name).toBe(
      'Kim Roe',
    );
    const [still] = await test.db.select().from(people).where(eq(people.id, ann.id));
    expect(still?.emails).toEqual(['jo@parker.example', 'ann@acme.example']);
  });

  it('refuses to merge a person who does not hold the address', async () => {
    const { jo } = await pair();
    const [kim] = await test.db
      .insert(people)
      .values({ name: 'Kim Roe', emails: ['kim@roe.example'] })
      .returning();
    const response = await call('PATCH', `/people/${jo.id}`, {
      emails: ['jo@parker.example'],
      mergeFrom: kim?.id,
    });
    expect(response.status).toBe(409);
    expect(await test.db.select().from(people)).toHaveLength(3);
  });

  it('moves the meetings of the other person over and keeps Do not track', async () => {
    const { jo, ann } = await pair();
    await test.db.update(people).set({ tracking: 'off' }).where(eq(people.id, ann.id));
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Sync', platform: 'recording', joinUrl: '', status: 'transcribed' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    await test.db
      .insert(participants)
      .values({ meetingId: meeting.id, displayName: 'Ann Lee', personId: ann.id });
    const response = await call('PATCH', `/people/${jo.id}`, {
      emails: ['jo@parker.example'],
      mergeFrom: ann.id,
    });
    expect(response.status).toBe(200);
    const [seat] = await test.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, meeting.id));
    expect(seat).toMatchObject({ personId: jo.id, displayName: 'Jo Parker' });
    const [merged] = await test.db.select().from(people).where(eq(people.id, jo.id));
    expect(merged?.tracking).toBe('off');
  });
});
