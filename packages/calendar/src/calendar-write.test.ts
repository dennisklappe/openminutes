import { SettingsStore } from '@openminutes/core';
import { calendarAccounts, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { completeAuthorization, startAuthorization } from './accounts.js';
import { addMinutesLink, CALENDAR_WRITE_SCOPES, hasCalendarWrite } from './calendar-write.js';
import type { CalendarContext } from './context.js';
import { startFakeCalendar, type FakeCalendar } from './fake/server.js';
import { createProviders } from './providers.js';
import type { CalendarProviderId } from '@openminutes/db';

const secret = 'a-long-enough-test-secret';
const redirectUri = 'https://openminutes.test/api/oauth/callback';
const url = 'https://om.test/s/abc';

describe('adding the minutes link to a calendar event', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let fake: FakeCalendar;
  let context: CalendarContext;

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  beforeEach(async () => {
    await test.db.delete(meetings);
    await test.db.delete(calendarAccounts);
    fake = await startFakeCalendar();
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
      queue: { send: () => Promise.resolve() },
    };
  });
  afterEach(() => fake.close());

  async function connect(provider: CalendarProviderId, write: boolean) {
    const { url: authUrl, codeVerifier } = await startAuthorization(context, provider, {
      redirectUri,
      state: 'state-1',
      extraScopes: write ? [...CALENDAR_WRITE_SCOPES[provider]] : [],
    });
    const callback = new URL(
      (await fetch(authUrl, { redirect: 'manual' })).headers.get('location') ?? '',
    );
    const accountId = await completeAuthorization(context, provider, {
      code: callback.searchParams.get('code') ?? '',
      redirectUri,
      codeVerifier,
    });
    const calendarExternalId = fake.store.primaryCalendar(provider);
    return { accountId, calendarExternalId, eventId: 'evt-1' };
  }

  const seed = (provider: CalendarProviderId, description: string, readOnly = false) => {
    fake.store.upsertEvent(provider, fake.store.primaryCalendar(provider), {
      id: 'evt-1',
      title: 'Weekly',
      start: '2026-10-23T10:00:00Z',
      end: '2026-10-23T11:00:00Z',
      description,
      readOnly,
    });
  };
  const description = (provider: CalendarProviderId) =>
    fake.store.getEvent(provider, fake.store.primaryCalendar(provider), 'evt-1')?.description;

  it.each(['google', 'microsoft'] as const)(
    'appends the link once, keeps the description and updates it in place (%s)',
    async (provider) => {
      const target = await connect(provider, true);
      seed(provider, '<p>Agenda</p>');
      expect(await addMinutesLink(context, target, url)).toEqual({ status: 'added' });
      expect(description(provider)).toContain('<p>Agenda</p>');
      expect(description(provider)).toContain(`<a href="${url}">`);
      expect(fake.store.patches).toHaveLength(1);

      expect(await addMinutesLink(context, target, url)).toEqual({ status: 'added' });
      expect(fake.store.patches).toHaveLength(1);

      await addMinutesLink(context, target, 'https://om.test/s/new');
      expect(description(provider)?.match(/Powered by OpenMinutes/g)).toHaveLength(1);
      expect(description(provider)).not.toContain(url);
    },
  );

  it('asks Google not to notify the guests', async () => {
    const target = await connect('google', true);
    seed('google', 'Plain text');
    await addMinutesLink(context, target, url);
    expect(new URLSearchParams(fake.store.patches[0]?.query).get('sendUpdates')).toBe('none');
  });

  it.each(['google', 'microsoft'] as const)(
    'reports no permission when the event cannot be edited (%s)',
    async (provider) => {
      const target = await connect(provider, true);
      seed(provider, 'Invited only', true);
      expect(await addMinutesLink(context, target, url)).toEqual({
        status: 'no_permission',
        error: 'Could not add link to calendar (no permission)',
      });
      expect(description(provider)).toBe('Invited only');
    },
  );

  it('asks to reconnect when the account never allowed calendar edits', async () => {
    const target = await connect('google', false);
    seed('google', 'Plain text');
    expect(await addMinutesLink(context, target, url)).toMatchObject({ status: 'needs_reconnect' });
    expect(fake.store.patches).toHaveLength(0);
  });

  it('does not retry an event that no longer exists', async () => {
    const target = await connect('google', true);
    expect(await addMinutesLink(context, target, url)).toMatchObject({
      status: 'failed',
      retryable: false,
    });
  });

  it('recognises granted write scopes', () => {
    expect(hasCalendarWrite('google', 'https://www.googleapis.com/auth/calendar.readonly')).toBe(
      false,
    );
    expect(hasCalendarWrite('google', 'https://www.googleapis.com/auth/calendar.events')).toBe(
      true,
    );
    expect(
      hasCalendarWrite('microsoft', 'https://graph.microsoft.com/Calendars.ReadWrite User.Read'),
    ).toBe(true);
    expect(hasCalendarWrite('microsoft', undefined)).toBe(false);
  });
});
