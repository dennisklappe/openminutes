import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { startFakeCalendar, type FakeCalendar } from '@openminutes/calendar/fake';
import {
  CALENDAR_LINK_RETRY,
  LocalStorage,
  SettingsStore,
  type JobName,
  type JobPayloads,
} from '@openminutes/core';
import { calendars, meetings, meetingSources, shareLinks } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { AccountsDto, ExportSettingsDto, MeetingDetailDto } from '../dto.js';
import { runCalendarLink } from './calendar-link.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const publicUrl = 'https://openminutes.test';

describe('minutes link in the calendar', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let fake: FakeCalendar;
  let app: Hono;
  let settings: SettingsStore;
  let session = '';
  let calendarId = '';
  const sent: { name: JobName; payload: JobPayloads[JobName]; options: unknown }[] = [];
  const primary = () => fake.store.primaryCalendar('google');
  const deps = () => ({
    calendar: {
      db: test.db,
      settings,
      secret,
      providers: createProviders({ fakeBaseUrl: fake.baseUrl }),
      queue: { send: () => Promise.resolve() },
    },
    publicUrl,
  });

  beforeAll(async () => {
    test = await createTestDatabase();
    fake = await startFakeCalendar();
    settings = new SettingsStore(test.db, secret);
    await settings.set('google.client_id', 'cid');
    await settings.set('google.client_secret', 'csecret');
    app = createApp({
      db: test.db,
      settings,
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-link-'))),
      secret,
      calendarProviders: createProviders({ fakeBaseUrl: fake.baseUrl }),
      publicUrl,
      version: '1.2.3',
      queue: {
        send: (name, payload, options) => {
          sent.push({ name, payload, options });
          return Promise.resolve();
        },
      },
    });
    const created = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    session = created.headers.get('set-cookie')?.split(';')[0] ?? '';
  });
  afterAll(async () => {
    await fake.close();
    await test.close();
  });

  const request = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...json, cookie: session } });

  async function connect(query: string): Promise<void> {
    const start = await request(`/api/oauth/google/start${query}`);
    const oauthCookie = start.headers.get('set-cookie')?.split(';')[0] ?? '';
    const consent = await fetch(start.headers.get('location') ?? '', { redirect: 'manual' });
    const callback = new URL(consent.headers.get('location') ?? '');
    const done = await app.request(`/api/oauth/google/callback${callback.search}`, {
      headers: { cookie: oauthCookie },
    });
    expect(done.headers.get('location')).toBe(
      `${query ? '/#/settings/minutes' : '/#/settings'}?connected=google`,
    );
  }

  async function meetingWithEvents(...eventIds: string[]) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Weekly',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    for (const eventId of eventIds) {
      await test.db.insert(meetingSources).values({
        meetingId: meeting.id,
        calendarId,
        calendarEventId: eventId,
        joinable: true,
      });
    }
    return meeting.id;
  }

  const seed = (id: string, description: string, readOnly = false) => {
    fake.store.upsertEvent('google', primary(), {
      id,
      title: 'Weekly',
      start: '2026-10-23T10:00:00Z',
      end: '2026-10-23T11:00:00Z',
      description,
      readOnly,
    });
  };
  const description = (id: string) => fake.store.getEvent('google', primary(), id)?.description;
  const detail = async (id: string) =>
    (await (await request(`/api/meetings/${id}`)).json()) as MeetingDetailDto;

  it('flags accounts that may not edit events and upgrades them on reconnect', async () => {
    await connect('');
    const before = (await (await request('/api/accounts')).json()) as AccountsDto;
    expect(before.accounts[0]?.canWriteCalendar).toBe(false);
    const settingsBefore = (await (
      await request('/api/settings/minutes/export')
    ).json()) as ExportSettingsDto;
    expect(settingsBefore).toMatchObject({ calendarLink: false, accounts: [{ canWrite: false }] });

    await connect('?calendar=write');
    const after = (await (await request('/api/accounts')).json()) as AccountsDto;
    expect(after.accounts).toHaveLength(1);
    expect(after.accounts[0]?.canWriteCalendar).toBe(true);
    calendarId =
      (
        await test.db
          .insert(calendars)
          .values({
            accountId: after.accounts[0]?.id ?? '',
            externalId: primary(),
            name: 'Primary',
            isPrimary: true,
          })
          .returning()
      )[0]?.id ?? '';
  });

  it('saves the setting with the export settings, off by default', async () => {
    const current = (await (
      await request('/api/settings/minutes/export')
    ).json()) as ExportSettingsDto;
    expect(current.calendarLink).toBe(false);
    const put = (body: object) =>
      request('/api/settings/minutes/export', { method: 'PUT', body: JSON.stringify(body) });
    const base = {
      target: null,
      googleAccountId: null,
      microsoftAccountId: null,
      ownerEmail: '',
      auto: false,
    };
    expect(
      ((await (await put({ ...base, calendarLink: true })).json()) as ExportSettingsDto)
        .calendarLink,
    ).toBe(true);
    expect(await settings.get('minutes.calendar_link')).toBe('true');
    await put(base);
    expect(await settings.get('minutes.calendar_link')).toBe('true');
    await put({ ...base, calendarLink: false });
    expect(await settings.get('minutes.calendar_link')).toBe('false');
    await settings.delete('minutes.calendar_link');
  });

  it('writes one permanent share link into every event, once, and reports each calendar', async () => {
    seed('e1', '<p>Agenda</p>');
    seed('e2', 'Invited only', true);
    const id = await meetingWithEvents('e1', 'e2');
    expect((await detail(id)).calendarLinks.map((l) => l.status)).toEqual(['pending', 'pending']);

    await runCalendarLink(deps(), id);
    const [share] = await test.db.select().from(shareLinks);
    expect(share).toMatchObject({ meetingId: id, expiresAt: null, includeTranscript: false });
    expect(description('e1')).toContain(`<a href="${publicUrl}/s/${share?.token}">`);
    expect(description('e1')).toContain('<p>Agenda</p>');
    expect(description('e2')).toBe('Invited only');
    expect(new URLSearchParams(fake.store.patches[0]?.query).get('sendUpdates')).toBe('none');

    const links = (await detail(id)).calendarLinks;
    expect(links.map((l) => l.status).sort()).toEqual(['added', 'no_permission']);
    expect(links.find((l) => l.status === 'no_permission')?.error).toBe(
      'Could not add link to calendar (no permission)',
    );

    const patches = fake.store.patches.length;
    await runCalendarLink(deps(), id);
    expect(fake.store.patches).toHaveLength(patches);
    expect(await test.db.select().from(shareLinks)).toHaveLength(1);
  });

  it('follows the minutes setting for the transcript', async () => {
    await settings.set('minutes.include_transcript', 'true');
    seed('e3', '');
    await runCalendarLink(deps(), await meetingWithEvents('e3'));
    const rows = await test.db.select().from(shareLinks);
    expect(rows.at(-1)?.includeTranscript).toBe(true);
  });

  it('records a clear failure without retrying when no public URL is set', async () => {
    seed('e4', '');
    const id = await meetingWithEvents('e4');
    await runCalendarLink({ ...deps(), publicUrl: undefined }, id);
    expect((await detail(id)).calendarLinks[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('OPENMINUTES_PUBLIC_URL') as string,
    });
  });

  it('queues a forced run with retries from the meeting page action', async () => {
    const id = await meetingWithEvents('e6');
    const response = await request(`/api/meetings/${id}/calendar-link`, {
      method: 'POST',
      headers: { ...json, cookie: session, origin: 'http://localhost' },
    });
    expect(response.status).toBe(202);
    expect(sent.at(-1)).toEqual({
      name: 'meeting.calendar-link',
      payload: { meetingId: id, force: true },
      options: CALENDAR_LINK_RETRY,
    });
    const orphan = await test.db
      .insert(meetings)
      .values({
        title: 'Ad hoc',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/xyz-xyzx-xyz',
      })
      .returning();
    const refused = await request(`/api/meetings/${orphan[0]?.id}/calendar-link`, {
      method: 'POST',
      headers: { ...json, cookie: session, origin: 'http://localhost' },
    });
    expect(refused.status).toBe(409);
  });

  it('throws on a temporary failure so the queue retries', async () => {
    seed('e5', '');
    const id = await meetingWithEvents('e5');
    await fake.close();
    await expect(runCalendarLink(deps(), id)).rejects.toThrow('Could not add the minutes link');
    expect((await detail(id)).calendarLinks[0]?.status).toBe('failed');
    fake = await startFakeCalendar();
  });
});
