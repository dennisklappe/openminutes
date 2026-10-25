import {
  rejoinSeries,
  SettingsStore,
  skipSeries,
  type JobName,
  type JobPayloads,
} from '@openminutes/core';
import {
  calendarAccounts,
  calendars,
  eq,
  meetings,
  meetingSources,
  skippedSeries,
  type CalendarProviderId,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  completeAuthorization,
  disconnectAccount,
  setJoinRule,
  startAuthorization,
} from './accounts.js';
import type { CalendarContext } from './context.js';
import { startFakeCalendar, type FakeCalendar } from './fake/server.js';
import type { FakeEvent } from './fake/store.js';
import { createProviders } from './providers.js';
import { syncAccounts } from './sync.js';

const secret = 'a-long-enough-test-secret';
const redirectUri = 'https://openminutes.test/api/oauth/callback';
const meetUrl = 'https://meet.google.com/abc-defg-hij';
const teamsUrl = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0';

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

function event(id: string, overrides: Partial<FakeEvent> = {}): FakeEvent {
  return {
    id,
    title: `Meeting ${id}`,
    start: inHours(2),
    end: inHours(3),
    conferenceUrl: meetUrl,
    guests: ['guest@other.io'],
    ...overrides,
  };
}

describe('calendar sync', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let fake: FakeCalendar;
  let context: CalendarContext;
  const sent: { name: JobName; payload: JobPayloads[JobName] }[] = [];
  const scheduleJobs = () => sent.filter((job) => job.name === 'meeting.schedule');

  beforeAll(async () => {
    test = await createTestDatabase();
  });

  afterAll(async () => {
    await test.close();
  });

  beforeEach(async () => {
    sent.length = 0;
    await test.db.delete(meetings);
    await test.db.delete(calendarAccounts);
    fake = await startFakeCalendar({ pageSize: 2 });
    const settings = new SettingsStore(test.db, secret);
    for (const provider of ['google', 'microsoft'] as const) {
      await settings.set(`${provider}.client_id`, `${provider}-client`);
      await settings.set(`${provider}.client_secret`, `${provider}-secret`);
    }
    context = {
      db: test.db,
      settings,
      secret,
      providers: createProviders({ fakeBaseUrl: fake.baseUrl }),
      queue: {
        send: (name, payload) => {
          sent.push({ name, payload });
          return Promise.resolve();
        },
      },
    };
  });

  afterEach(async () => {
    await fake.close();
  });

  async function connect(provider: CalendarProviderId): Promise<string> {
    const { url, codeVerifier } = await startAuthorization(context, provider, {
      redirectUri,
      state: 'state-1',
    });
    const response = await fetch(url, { redirect: 'manual' });
    const callback = new URL(response.headers.get('location') ?? '');
    expect(callback.searchParams.get('state')).toBe('state-1');
    const accountId = await completeAuthorization(context, provider, {
      code: callback.searchParams.get('code') ?? '',
      redirectUri,
      codeVerifier,
    });
    await syncAccounts(context, accountId);
    return accountId;
  }

  async function calendarRows(accountId: string) {
    return test.db.select().from(calendars).where(eq(calendars.accountId, accountId));
  }

  async function setRule(
    accountId: string,
    primary: boolean,
    rule: Parameters<typeof setJoinRule>[2],
  ) {
    const row = (await calendarRows(accountId)).find((c) => c.isPrimary === primary);
    if (!row) throw new Error('calendar missing');
    await setJoinRule(context, row.id, rule);
  }

  const allMeetings = () => test.db.select().from(meetings).orderBy(meetings.title);

  describe('google', () => {
    const primary = () => fake.store.primaryCalendar('google');
    const put = (e: FakeEvent) => {
      fake.store.upsertEvent('google', primary(), e);
    };

    it('connects, stores encrypted tokens and discovers calendars with the never rule', async () => {
      const accountId = await connect('google');

      const [account] = await test.db.select().from(calendarAccounts);
      expect(account).toMatchObject({ provider: 'google', accountEmail: fake.store.email });
      expect(account?.encryptedTokens).toMatch(/^v1:/);
      expect(account?.encryptedTokens).not.toContain('refresh');
      expect(account?.lastSyncedAt).toBeInstanceOf(Date);
      expect((await calendarRows(accountId)).map((c) => [c.name, c.joinRule])).toEqual(
        expect.arrayContaining([
          ['Primary', 'never'],
          ['Team', 'never'],
        ]),
      );
      expect(sent).toEqual([{ name: 'calendar.sync', payload: { accountId } }]);
      expect(await allMeetings()).toEqual([]);
    });

    it('keeps a title the user edited when the event changes', async () => {
      const accountId = await connect('google');
      put(event('a'));
      await setRule(accountId, true, 'all');
      await syncAccounts(context, accountId);
      await test.db.update(meetings).set({ title: 'My title', titleEdited: true });

      const moved = inHours(5);
      put(event('a', { start: moved, end: inHours(6), title: 'Calendar rename' }));
      await syncAccounts(context, accountId);

      const [row] = await allMeetings();
      expect(row).toMatchObject({ title: 'My title', titleEdited: true });
      expect(row?.scheduledStart?.toISOString()).toBe(moved);
    });

    it('creates, dedupes, reschedules and cancels meetings', async () => {
      const accountId = await connect('google');
      put(event('a'));
      put(event('b', { conferenceUrl: undefined, description: 'no link here' }));
      put(event('c', { start: inHours(26), end: inHours(27) }));
      await setRule(accountId, true, 'all');
      await syncAccounts(context, accountId);

      let rows = await allMeetings();
      expect(rows.map((m) => [m.title, m.platform, m.status])).toEqual([
        ['Meeting a', 'meet', 'scheduled'],
        ['Meeting c', 'meet', 'scheduled'],
      ]);
      expect(scheduleJobs()).toHaveLength(2);

      sent.length = 0;
      await syncAccounts(context, accountId);
      expect(scheduleJobs()).toEqual([]);

      const moved = inHours(5);
      put(event('a', { start: moved, end: inHours(6), title: 'Renamed' }));
      await syncAccounts(context, accountId);
      rows = await allMeetings();
      const renamed = rows.find((m) => m.title === 'Renamed');
      expect(renamed).toMatchObject({ title: 'Renamed', status: 'scheduled' });
      expect(renamed?.scheduledStart?.toISOString()).toBe(moved);
      expect(scheduleJobs()).toEqual([
        { name: 'meeting.schedule', payload: { meetingId: renamed?.id } },
      ]);

      fake.store.removeEvent('google', primary(), 'c');
      await syncAccounts(context, accountId);
      rows = await allMeetings();
      expect(rows.map((m) => m.status)).toEqual(['cancelled', 'scheduled']);
    });

    it('re-evaluates existing meetings when the rule changes', async () => {
      const accountId = await connect('google');
      put(event('a', { organizerSelf: false }));
      put(event('b', { organizerSelf: true, start: inHours(4), end: inHours(5) }));
      await setRule(accountId, true, 'all');
      await syncAccounts(context, accountId);
      expect((await allMeetings()).map((m) => m.status)).toEqual(['scheduled', 'scheduled']);

      await setRule(accountId, true, 'organizer');
      await syncAccounts(context, accountId);
      expect((await allMeetings()).map((m) => m.status)).toEqual(['cancelled', 'scheduled']);

      await setRule(accountId, true, 'never');
      await syncAccounts(context, accountId);
      expect((await allMeetings()).map((m) => m.status)).toEqual(['cancelled', 'cancelled']);

      await setRule(accountId, true, 'all');
      await syncAccounts(context, accountId);
      expect((await allMeetings()).map((m) => m.status)).toEqual(['scheduled', 'scheduled']);
    });

    it('filters on external guests', async () => {
      const accountId = await connect('google');
      put(event('internal', { guests: [`colleague@${fake.store.email.split('@')[1]}`] }));
      put(event('external', { guests: ['client@other.io'] }));
      await setRule(accountId, true, 'external');
      await syncAccounts(context, accountId);
      expect((await allMeetings()).map((m) => m.title)).toEqual(['Meeting external']);
    });

    it('stores the location and invitees and refreshes them on change', async () => {
      const accountId = await connect('google');
      put(event('a', { location: 'Room 4', guests: ['client@other.io'] }));
      await setRule(accountId, true, 'all');
      await syncAccounts(context, accountId);
      const [first] = await allMeetings();
      expect(first?.location).toBe('Room 4');
      expect(first?.invitees?.map((i) => i.email)).toEqual([fake.store.email, 'client@other.io']);

      put(event('a', { guests: ['client@other.io', 'new@other.io'] }));
      await syncAccounts(context, accountId);
      const [second] = await allMeetings();
      expect(second?.location).toBeNull();
      expect(second?.invitees).toHaveLength(3);
    });

    it('keeps one meeting across a full resync', async () => {
      const accountId = await connect('google');
      put(event('a'));
      await setRule(accountId, true, 'all');
      await syncAccounts(context, accountId);
      await test.db.update(calendars).set({ syncState: null });
      await syncAccounts(context, accountId);
      expect(await allMeetings()).toHaveLength(1);
    });

    it('recovers from an expired sync token with a full sync', async () => {
      const accountId = await connect('google');
      put(event('a'));
      await setRule(accountId, true, 'all');
      await syncAccounts(context, accountId);
      await test.db
        .update(calendars)
        .set({ syncState: { token: 'garbage', windowEnd: inHours(24 * 14) } });

      fake.store.removeEvent('google', primary(), 'a');
      await syncAccounts(context, accountId);
      expect((await allMeetings()).map((m) => m.status)).toEqual(['cancelled']);
    });

    it('refreshes expiring tokens before syncing', async () => {
      const short = await startFakeCalendar({ expiresInSeconds: 30 });
      const shortContext = {
        ...context,
        providers: createProviders({ fakeBaseUrl: short.baseUrl }),
      };
      try {
        const { url, codeVerifier } = await startAuthorization(shortContext, 'google', {
          redirectUri,
          state: 's',
        });
        const callback = new URL(
          (await fetch(url, { redirect: 'manual' })).headers.get('location') ?? '',
        );
        const accountId = await completeAuthorization(shortContext, 'google', {
          code: callback.searchParams.get('code') ?? '',
          redirectUri,
          codeVerifier,
        });
        const [before] = await test.db.select().from(calendarAccounts);
        await syncAccounts(shortContext, accountId);
        const [after] = await test.db.select().from(calendarAccounts);
        expect(after?.lastError).toBeNull();
        expect(after?.encryptedTokens).not.toBe(before?.encryptedTokens);
      } finally {
        await short.close();
      }
    });

    it('records an error when access was revoked', async () => {
      const accountId = await connect('google');
      await test.db.update(calendarAccounts).set({
        encryptedTokens: (await test.db.select().from(calendarAccounts))[0]?.encryptedTokens ?? '',
      });
      fake.store.revokeAll();
      await syncAccounts(context, accountId);
      const [account] = await test.db.select().from(calendarAccounts);
      expect(account?.lastError).toBe('Invalid credentials');
    });

    it('cancels queued meetings when the account is disconnected', async () => {
      const accountId = await connect('google');
      put(event('a'));
      await setRule(accountId, true, 'all');
      await syncAccounts(context, accountId);
      await disconnectAccount(context, accountId);
      expect(await test.db.select().from(calendarAccounts)).toEqual([]);
      expect((await allMeetings()).map((m) => m.status)).toEqual(['cancelled']);
    });
  });

  describe('microsoft', () => {
    const primary = () => fake.store.primaryCalendar('microsoft');
    const put = (e: FakeEvent, calendar = primary()) => {
      fake.store.upsertEvent('microsoft', calendar, e);
    };

    it('syncs the default calendar through delta queries', async () => {
      const accountId = await connect('microsoft');
      put(event('t1', { conferenceUrl: teamsUrl }));
      put(event('t2', { conferenceUrl: teamsUrl, start: inHours(30), end: inHours(31) }));
      put(event('t3', { conferenceUrl: teamsUrl, start: inHours(40), end: inHours(41) }));
      await setRule(accountId, true, 'all');
      await syncAccounts(context, accountId);
      expect((await allMeetings()).map((m) => [m.platform, m.joinUrl, m.status])).toEqual([
        ['teams', teamsUrl, 'scheduled'],
        ['teams', teamsUrl, 'scheduled'],
        ['teams', teamsUrl, 'scheduled'],
      ]);

      const [state] = (await calendarRows(accountId))
        .filter((c) => c.isPrimary)
        .map((c) => c.syncState);
      expect(state?.token).toContain('$deltatoken=');

      put(
        event('t1', {
          conferenceUrl: teamsUrl,
          title: 'Moved',
          start: inHours(8),
          end: inHours(9),
        }),
      );
      fake.store.removeEvent('microsoft', primary(), 't3');
      sent.length = 0;
      await syncAccounts(context, accountId);
      const rows = await allMeetings();
      expect(rows.map((m) => [m.title, m.status])).toEqual([
        ['Meeting t2', 'scheduled'],
        ['Meeting t3', 'cancelled'],
        ['Moved', 'scheduled'],
      ]);
      expect(scheduleJobs()).toHaveLength(1);
    });

    it('polls secondary calendars and cancels events that disappear', async () => {
      const accountId = await connect('microsoft');
      const team = fake.store.calendarsOf('microsoft')[1]?.id ?? '';
      put(event('s1', { conferenceUrl: teamsUrl }), team);
      await setRule(accountId, false, 'all');
      await syncAccounts(context, accountId);
      expect((await allMeetings()).map((m) => m.status)).toEqual(['scheduled']);

      fake.store.removeEvent('microsoft', team, 's1');
      await syncAccounts(context, accountId);
      expect((await allMeetings()).map((m) => m.status)).toEqual(['cancelled']);
    });
  });
  describe('the same meeting in several calendars', () => {
    const minute = 60_000;
    const slot = (hours: number) =>
      new Date(Math.ceil((Date.now() + hours * 3_600_000) / minute) * minute).toISOString();
    const shared = (id: string, hours = 3, overrides: Partial<FakeEvent> = {}) =>
      event(id, { start: slot(hours), end: slot(hours + 1), ...overrides });
    const googlePrimary = () => fake.store.primaryCalendar('google');
    const googleTeam = () => fake.store.calendarsOf('google')[1]?.id ?? '';
    const msPrimary = () => fake.store.primaryCalendar('microsoft');
    const sources = () => test.db.select().from(meetingSources);

    async function connectBoth() {
      const google = await connect('google');
      const microsoft = await connect('microsoft');
      return { google, microsoft };
    }

    async function openAll(accounts: { google: string; microsoft: string }) {
      await setRule(accounts.google, true, 'all');
      await setRule(accounts.google, false, 'all');
      await setRule(accounts.microsoft, true, 'all');
      await syncAll();
    }

    const syncAll = () => syncAccounts(context);

    it('creates one meeting and one schedule job for copies in three calendars', async () => {
      const accounts = await connectBoth();
      fake.store.upsertEvent('google', googlePrimary(), shared('organizer-copy'));
      fake.store.upsertEvent('google', googleTeam(), shared('team-copy'));
      fake.store.upsertEvent(
        'microsoft',
        msPrimary(),
        shared('forwarded-copy', 3, { conferenceUrl: `${meetUrl}?authuser=2` }),
      );
      sent.length = 0;
      await openAll(accounts);

      expect(await allMeetings()).toHaveLength(1);
      expect(scheduleJobs()).toHaveLength(1);
      expect(await sources()).toHaveLength(3);
      expect((await sources()).every((source) => source.joinable)).toBe(true);

      sent.length = 0;
      await test.db.update(calendars).set({ syncState: null });
      await syncAll();
      expect(await allMeetings()).toHaveLength(1);
      expect(scheduleJobs()).toEqual([]);
    });

    it('creates one meeting when two syncs run at the same time', async () => {
      const accounts = await connectBoth();
      fake.store.upsertEvent('google', googlePrimary(), shared('a'));
      fake.store.upsertEvent('microsoft', msPrimary(), shared('b'));
      await setRule(accounts.google, true, 'all');
      await setRule(accounts.microsoft, true, 'all');
      sent.length = 0;

      await Promise.all([
        syncAccounts(context, accounts.google),
        syncAccounts(context, accounts.microsoft),
      ]);

      expect(await allMeetings()).toHaveLength(1);
      expect(await sources()).toHaveLength(2);
      expect(scheduleJobs()).toHaveLength(1);
    });

    it('joins when any calendar rule allows it and cancels only when none does', async () => {
      const accounts = await connectBoth();
      fake.store.upsertEvent('google', googlePrimary(), shared('a', 3, { organizerSelf: false }));
      fake.store.upsertEvent('microsoft', msPrimary(), shared('b', 3, { organizerSelf: false }));
      await setRule(accounts.google, true, 'organizer');
      await setRule(accounts.microsoft, true, 'all');
      await syncAll();
      expect((await allMeetings()).map((m) => m.status)).toEqual(['scheduled']);

      await setRule(accounts.microsoft, true, 'never');
      await syncAll();
      expect((await allMeetings()).map((m) => m.status)).toEqual(['cancelled']);

      sent.length = 0;
      await setRule(accounts.google, true, 'all');
      await syncAll();
      expect((await allMeetings()).map((m) => m.status)).toEqual(['scheduled']);
      expect(scheduleJobs()).toHaveLength(1);
    });

    it('stays scheduled while one calendar still has it and cancels when all dropped it', async () => {
      const accounts = await connectBoth();
      fake.store.upsertEvent('google', googlePrimary(), shared('a'));
      fake.store.upsertEvent('microsoft', msPrimary(), shared('b'));
      await openAll(accounts);

      fake.store.removeEvent('google', googlePrimary(), 'a');
      await syncAll();
      expect((await allMeetings()).map((m) => m.status)).toEqual(['scheduled']);

      fake.store.removeEvent('microsoft', msPrimary(), 'b');
      await syncAll();
      expect((await allMeetings()).map((m) => m.status)).toEqual(['cancelled']);
    });

    it('moves a rescheduled meeting once every copy reports the new time', async () => {
      const accounts = await connectBoth();
      fake.store.upsertEvent('google', googlePrimary(), shared('a'));
      fake.store.upsertEvent('microsoft', msPrimary(), shared('b'));
      await openAll(accounts);

      const moved = slot(6);
      fake.store.upsertEvent('google', googlePrimary(), shared('a', 6));
      await syncAccounts(context, accounts.google);
      fake.store.upsertEvent('microsoft', msPrimary(), shared('b', 6));
      await syncAccounts(context, accounts.microsoft);

      const live = (await allMeetings()).filter((m) => m.status === 'scheduled');
      expect(live).toHaveLength(1);
      expect(live[0]?.scheduledStart?.toISOString()).toBe(moved);
      expect((await sources()).every((source) => source.meetingId === live[0]?.id)).toBe(true);
    });

    it('moves a single-calendar meeting in place on reschedule', async () => {
      const accounts = await connectBoth();
      fake.store.upsertEvent('google', googlePrimary(), shared('a'));
      await openAll(accounts);
      const [before] = await allMeetings();

      fake.store.upsertEvent('google', googlePrimary(), shared('a', 7));
      await syncAccounts(context, accounts.google);

      const rows = await allMeetings();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(before?.id);
      expect(rows[0]?.scheduledStart?.toISOString()).toBe(slot(7));
    });

    it('does not touch a meeting that already started', async () => {
      const accounts = await connectBoth();
      fake.store.upsertEvent('google', googlePrimary(), shared('a'));
      fake.store.upsertEvent('microsoft', msPrimary(), shared('b'));
      await openAll(accounts);
      await test.db.update(meetings).set({ status: 'recording' });

      fake.store.removeEvent('google', googlePrimary(), 'a');
      fake.store.removeEvent('microsoft', msPrimary(), 'b');
      await syncAll();
      expect((await allMeetings()).map((m) => m.status)).toEqual(['recording']);
    });

    it('lists the source calendars and drops a calendar that is disconnected', async () => {
      const accounts = await connectBoth();
      fake.store.upsertEvent('google', googlePrimary(), shared('a'));
      fake.store.upsertEvent('microsoft', msPrimary(), shared('b'));
      await openAll(accounts);
      expect(await sources()).toHaveLength(2);

      await disconnectAccount(context, accounts.google);
      expect((await allMeetings()).map((m) => m.status)).toEqual(['scheduled']);
      expect(await sources()).toHaveLength(1);

      await disconnectAccount(context, accounts.microsoft);
      expect((await allMeetings()).map((m) => m.status)).toEqual(['cancelled']);
    });

    it('adopts a meeting stored before join keys existed', async () => {
      const accounts = await connectBoth();
      fake.store.upsertEvent('google', googlePrimary(), shared('a'));
      await openAll(accounts);
      const [meeting] = await allMeetings();
      await test.db.update(meetings).set({ joinKey: null });
      await test.db.update(calendars).set({ syncState: null });

      await syncAll();
      const rows = await allMeetings();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: meeting?.id, joinKey: 'meet:abc-defg-hij' });
    });

    describe('a skipped meeting', () => {
      async function skippedMeeting() {
        const accounts = await connectBoth();
        fake.store.upsertEvent('google', googlePrimary(), shared('a'));
        fake.store.upsertEvent('microsoft', msPrimary(), shared('b'));
        await openAll(accounts);
        await test.db.update(meetings).set({ status: 'skipped' });
        sent.length = 0;
        return accounts;
      }

      it('is not queued again by a full resync of every copy', async () => {
        await skippedMeeting();
        await test.db.update(calendars).set({ syncState: null });
        await syncAll();
        await syncAll();

        expect((await allMeetings()).map((m) => m.status)).toEqual(['skipped']);
        expect(await allMeetings()).toHaveLength(1);
        expect(scheduleJobs()).toEqual([]);
      });

      it('stays skipped but follows the calendar when the time moves', async () => {
        const accounts = await skippedMeeting();
        const moved = slot(6);
        fake.store.upsertEvent('google', googlePrimary(), shared('a', 6));
        await syncAccounts(context, accounts.google);
        fake.store.upsertEvent('microsoft', msPrimary(), shared('b', 6));
        await syncAccounts(context, accounts.microsoft);

        const live = (await allMeetings()).filter((m) => m.status !== 'cancelled');
        expect(live).toHaveLength(1);
        expect(live[0]?.status).toBe('skipped');
        expect(live[0]?.scheduledStart?.toISOString()).toBe(moved);
        expect(scheduleJobs()).toEqual([]);
      });

      it('stays skipped when the calendar drops and restores the event', async () => {
        await skippedMeeting();
        fake.store.removeEvent('google', googlePrimary(), 'a');
        fake.store.removeEvent('microsoft', msPrimary(), 'b');
        await syncAll();
        fake.store.upsertEvent('google', googlePrimary(), shared('a'));
        await syncAll();

        expect((await allMeetings()).map((m) => m.status)).toEqual(['skipped']);
        expect(scheduleJobs()).toEqual([]);
      });
    });

    describe.each([
      ['binned', { deletedAt: new Date() }],
      ['archived', { archivedAt: new Date() }],
    ])('a %s meeting', (_name, flag) => {
      async function settledMeeting() {
        const accounts = await connectBoth();
        fake.store.upsertEvent('google', googlePrimary(), shared('a'));
        fake.store.upsertEvent('microsoft', msPrimary(), shared('b'));
        await openAll(accounts);
        await test.db.update(meetings).set({ status: 'transcribed', ...flag });
        sent.length = 0;
      }

      it('is not recreated or queued by a full resync, and keeps its calendar sources', async () => {
        await settledMeeting();
        await test.db.update(calendars).set({ syncState: null });
        await syncAll();
        await syncAll();

        const rows = await allMeetings();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: 'transcribed', ...flag });
        expect(scheduleJobs()).toEqual([]);
        expect(await sources()).toHaveLength(2);
      });

      it('is not recreated when the calendar drops and restores the event', async () => {
        await settledMeeting();
        fake.store.removeEvent('google', googlePrimary(), 'a');
        fake.store.removeEvent('microsoft', msPrimary(), 'b');
        await syncAll();
        fake.store.upsertEvent('google', googlePrimary(), shared('a'));
        await syncAll();

        const rows = await allMeetings();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: 'transcribed', ...flag });
        expect(scheduleJobs()).toEqual([]);
      });
    });

    describe('a skipped series', () => {
      const weekly = (id: string, hours: number) =>
        shared(id, hours, { seriesId: 'weekly-speerpunten' });

      it('creates new occurrences as skipped without queueing a join', async () => {
        const accounts = await connectBoth();
        fake.store.upsertEvent('google', googlePrimary(), weekly('mon', 3));
        await openAll(accounts);
        const [first] = await allMeetings();
        expect(first?.seriesKey).toBe('google:weekly-speerpunten');
        await skipSeries({ db: test.db }, first?.id ?? '');
        sent.length = 0;

        fake.store.upsertEvent('google', googlePrimary(), {
          ...weekly('next', 27),
          conferenceUrl: 'https://meet.google.com/xyz-abcd-efg',
        });
        await syncAll();

        const rows = await allMeetings();
        expect(rows.map((m) => m.status)).toEqual(['skipped', 'skipped']);
        expect(scheduleJobs()).toEqual([]);
      });

      it('schedules occurrences again after the series is joined again', async () => {
        const accounts = await connectBoth();
        fake.store.upsertEvent('google', googlePrimary(), weekly('mon', 3));
        await openAll(accounts);
        const [first] = await allMeetings();
        await skipSeries({ db: test.db }, first?.id ?? '');
        const [series] = await test.db.select().from(skippedSeries);
        sent.length = 0;

        await rejoinSeries(context, series?.id ?? '');

        expect((await allMeetings()).map((m) => m.status)).toEqual(['scheduled']);
        expect(scheduleJobs()).toHaveLength(1);
      });
    });
  });
});
