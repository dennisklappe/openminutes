import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import {
  calendarAccounts,
  calendars,
  eq,
  meetingInvitees,
  meetingSources,
  meetings,
  people,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { LinkableEventsDto, MeetingDetailDto, UpcomingMeetingsDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const at = new Date('2026-10-20T10:00:00Z');
const invitees = [
  { email: 'jo@acme.example', name: 'Jo Parker', declined: false },
  { email: 'ann@acme.example', name: 'Ann Lee', declined: false },
  { email: 'old@acme.example', name: 'Old Hand', declined: true },
  { email: 'room1@resource.calendar.google.com', name: 'Room 1', declined: false },
];

describe('linking a recording to a calendar meeting', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let cookie = '';
  let calendarId = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-link-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.0.0',
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
    await test.db.delete(meetings);
    await test.db.delete(people);
    await test.db.delete(calendarAccounts);
    const [account] = await test.db
      .insert(calendarAccounts)
      .values({ provider: 'google', accountEmail: 'me@acme.example', encryptedTokens: 'v1:x' })
      .returning();
    const [calendar] = await test.db
      .insert(calendars)
      .values({ accountId: account?.id ?? '', externalId: 'primary', name: 'Work' })
      .returning();
    calendarId = calendar?.id ?? '';
  });

  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...json, cookie, origin: 'http://localhost' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  /** A skipped calendar meeting with the event it came from. */
  async function skipped(values: Partial<typeof meetings.$inferInsert> = {}) {
    const [event] = await test.db
      .insert(meetings)
      .values({
        title: 'Budget review',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        joinKey: 'abc-defg-hij',
        status: 'skipped',
        scheduledStart: at,
        seriesKey: 'series-1',
        location: 'Room 1',
        invitees,
        company: 'Acme',
        companySource: 'calendar',
        ...values,
      })
      .returning();
    if (!event) throw new Error('insert failed');
    await test.db.insert(meetingSources).values({
      meetingId: event.id,
      calendarId,
      calendarEventId: `event-${event.id}`,
      joinable: true,
    });
    return event;
  }

  async function recording(values: Partial<typeof meetings.$inferInsert> = {}) {
    const [row] = await test.db
      .insert(meetings)
      .values({
        title: 'Recording 20 Oct 2026, 10:05 UTC',
        platform: 'recording',
        joinUrl: 'phone://x',
        status: 'transcribed',
        startedAt: new Date('2026-10-20T10:05:00Z'),
        ...values,
      })
      .returning();
    if (!row) throw new Error('insert failed');
    return row;
  }

  const row = async (id: string) =>
    (await test.db.select().from(meetings).where(eq(meetings.id, id)))[0];
  const link = (id: string, eventId: string) =>
    call('POST', `/meetings/${id}/link-event`, { eventId });

  it('lists the skipped and scheduled meetings of a window, with who is expected', async () => {
    const event = await skipped();
    await skipped({
      title: 'Later',
      joinKey: 'k2',
      scheduledStart: new Date('2026-10-22T10:00:00Z'),
    });
    await skipped({ title: 'Done', joinKey: 'k3', status: 'transcribed' });
    await skipped({ title: 'Binned', joinKey: 'k4', deletedAt: new Date() });
    const query = `from=${encodeURIComponent('2026-10-20T00:00:00Z')}&to=${encodeURIComponent('2026-10-21T00:00:00Z')}`;
    const found = (await (
      await call('GET', `/meetings/linkable-events?${query}`)
    ).json()) as LinkableEventsDto;
    expect(found.items).toEqual([
      {
        id: event.id,
        title: 'Budget review',
        scheduledStart: '2026-10-20T10:00:00.000Z',
        status: 'skipped',
        location: 'Room 1',
        people: 2,
        names: ['Jo Parker', 'Ann Lee'],
      },
    ]);
  });

  it('refuses a missing or reversed time window', async () => {
    expect((await call('GET', '/meetings/linkable-events')).status).toBe(400);
    const reversed = 'from=2026-10-21T00:00:00Z&to=2026-10-20T00:00:00Z';
    expect((await call('GET', `/meetings/linkable-events?${reversed}`)).status).toBe(400);
  });

  it('gives the recording the title, date, invitees and company, and takes over the event', async () => {
    const event = await skipped();
    const made = await recording();
    expect((await link(made.id, event.id)).status).toBe(200);

    expect(await row(made.id)).toMatchObject({
      title: 'Budget review',
      titleEdited: true,
      scheduledStart: at,
      seriesKey: 'series-1',
      location: 'Room 1',
      company: 'Acme',
      companySource: 'calendar',
      platform: 'recording',
      status: 'transcribed',
      joinKey: null,
    });
    expect((await row(made.id))?.invitees).toEqual(invitees);
    expect(await row(event.id)).toBeUndefined();
    const sources = await test.db.select().from(meetingSources);
    expect(sources.map((source) => source.meetingId)).toEqual([made.id]);
  });

  it('seats the invitees as people of the meeting, like a meeting the bot joined', async () => {
    const event = await skipped();
    const made = await recording();
    await link(made.id, event.id);
    const names = (await test.db.select().from(people)).map((person) => person.name).sort();
    expect(names).toEqual(['Ann Lee', 'Jo Parker']);
    const invited = await test.db
      .select()
      .from(meetingInvitees)
      .where(eq(meetingInvitees.meetingId, made.id));
    expect(invited).toHaveLength(2);
  });

  it('no longer shows the covered meeting as skipped or upcoming', async () => {
    const soon = new Date(Date.now() + 2 * 3_600_000);
    const event = await skipped({ scheduledStart: soon });
    const made = await recording({ status: 'uploading', startedAt: new Date() });
    const upcoming = async () =>
      (await (await call('GET', '/meetings/upcoming')).json()) as UpcomingMeetingsDto;
    expect((await upcoming()).items.map((item) => item.id)).toEqual([event.id]);
    await link(made.id, event.id);
    expect((await upcoming()).items).toEqual([]);
    expect((await row(made.id))?.scheduledStart).toEqual(soon);
  });

  it('keeps a title the user edited and what the recording already has', async () => {
    const event = await skipped();
    const made = await recording({
      title: 'My own title',
      titleEdited: true,
      company: 'Globex',
      companySource: 'manual',
      invitees: [{ email: 'sam@globex.example', name: 'Sam Roe', declined: false }],
    });
    await link(made.id, event.id);
    const linked = await row(made.id);
    expect(linked).toMatchObject({
      title: 'My own title',
      company: 'Globex',
      companySource: 'manual',
    });
    expect(linked?.invitees?.map((invitee) => invitee.email)).toEqual([
      'jo@acme.example',
      'ann@acme.example',
      'old@acme.example',
      'room1@resource.calendar.google.com',
      'sam@globex.example',
    ]);
  });

  it('sets the speakers to the number invited while the recording is not transcribed yet', async () => {
    const event = await skipped();
    const waiting = await recording({ status: 'ended' });
    await link(waiting.id, event.id);
    expect((await row(waiting.id))?.speakerCount).toBe(2);

    const other = await skipped({ joinKey: 'k2' });
    const chosen = await recording({ status: 'ended', speakerCount: 4 });
    await link(chosen.id, other.id);
    expect((await row(chosen.id))?.speakerCount).toBe(4);

    const third = await skipped({ joinKey: 'k3' });
    const done = await recording({ status: 'transcribed' });
    await link(done.id, third.id);
    expect((await row(done.id))?.speakerCount).toBeNull();
  });

  it('leaves the speakers on Auto for an invitation of one person or of a crowd', async () => {
    const alone = await skipped({
      invitees: [invitees[0] ?? { email: '', name: null, declined: false }],
    });
    const solo = await recording({ status: 'ended' });
    await link(solo.id, alone.id);
    expect((await row(solo.id))?.speakerCount).toBeNull();

    const crowd = await skipped({
      joinKey: 'k2',
      invitees: Array.from({ length: 8 }, (_, i) => ({
        email: `guest${String(i)}@acme.example`,
        name: null,
        declined: false,
      })),
    });
    const big = await recording({ status: 'ended' });
    await link(big.id, crowd.id);
    expect((await row(big.id))?.speakerCount).toBe(5);
  });

  it('refuses a recording that is linked already, and a meeting that is gone or was recorded', async () => {
    const event = await skipped();
    const second = await skipped({ joinKey: 'k2' });
    const made = await recording();
    expect((await link(made.id, event.id)).status).toBe(200);
    expect((await link(made.id, second.id)).status).toBe(409);

    const other = await recording();
    expect((await link(other.id, event.id)).status).toBe(404);
    const joined = await skipped({ joinKey: 'k3', status: 'transcribed' });
    expect((await link(other.id, joined.id)).status).toBe(409);
    const phone = await recording({ title: 'Another recording' });
    expect((await link(other.id, phone.id)).status).toBe(409);
    expect((await link(event.id, second.id)).status).toBe(404);
    expect((await link('nope', second.id)).status).toBe(400);
    expect((await call('POST', `/meetings/${other.id}/link-event`, {})).status).toBe(400);
  });

  it('offers the link on a recording without a calendar meeting, with the expected people', async () => {
    const event = await skipped();
    const made = await recording();
    const detail = async (id: string) =>
      (await (await call('GET', `/meetings/${id}`)).json()) as MeetingDetailDto;
    expect(await detail(made.id)).toMatchObject({ canLinkEvent: true, expectedPeople: null });
    await link(made.id, event.id);
    expect(await detail(made.id)).toMatchObject({ canLinkEvent: false, expectedPeople: 2 });
    expect((await detail(made.id)).calendars).toEqual([
      { name: 'Work', accountEmail: 'me@acme.example' },
    ]);
    expect((await detail((await skipped({ joinKey: 'k2' })).id)).canLinkEvent).toBe(false);
  });
});
