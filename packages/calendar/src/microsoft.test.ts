import { describe, expect, it } from 'vitest';
import { endpointsFor } from './endpoints.js';
import { AuthRevokedError, SyncExpiredError } from './errors.js';
import { createMicrosoftProvider } from './microsoft.js';
import { mockFetch } from './test-helpers.js';
import type { Credentials, SyncRequest } from './types.js';

const credentials: Credentials = { clientId: 'cid', clientSecret: 'secret', tenant: 'tenant-1' };
const endpoints = endpointsFor().microsoft;
const primary = { externalId: 'AAA=', name: 'Calendar', isPrimary: true };
const secondary = { externalId: 'BBB=', name: 'Team', isPrimary: false };
const window = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-15T00:00:00Z') };
const full: SyncRequest = { state: null, window, accountEmail: 'Me@Example.com' };
const teams =
  'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d';

describe('microsoft provider', () => {
  it('builds an authorization URL on the configured tenant', () => {
    const { fetch } = mockFetch(() => ({ body: {} }));
    const url = new URL(
      createMicrosoftProvider(endpoints, fetch).authorizeUrl(credentials, {
        redirectUri: 'https://openminutes.test/api/oauth/microsoft/callback',
        state: 'st',
        codeChallenge: 'ch',
      }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('scope')).toBe(
      'openid email offline_access User.Read Calendars.Read',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('exchanges a code and rotates the refresh token', async () => {
    const { fetch, requests } = mockFetch((request) => ({
      body:
        request.form.get('grant_type') === 'authorization_code'
          ? { access_token: 'a1', refresh_token: 'r1', expires_in: '3599' }
          : { access_token: 'a2', refresh_token: 'r2', expires_in: 3599 },
    }));
    const provider = createMicrosoftProvider(endpoints, fetch);
    expect(await provider.exchangeCode(credentials, 'code', 'https://x/cb', 'v')).toMatchObject({
      accessToken: 'a1',
      refreshToken: 'r1',
    });
    expect(requests[0]?.url.pathname).toBe('/tenant-1/oauth2/v2.0/token');
    expect(await provider.refresh(credentials, 'r1')).toMatchObject({ refreshToken: 'r2' });
  });

  it('defaults the tenant to common and reports a revoked grant', async () => {
    const { fetch, requests } = mockFetch(() => ({
      status: 400,
      body: { error: 'invalid_grant' },
    }));
    const provider = createMicrosoftProvider(endpoints, fetch);
    await expect(
      provider.refresh({ clientId: 'c', clientSecret: 's' }, 'r'),
    ).rejects.toBeInstanceOf(AuthRevokedError);
    expect(requests[0]?.url.pathname).toBe('/common/oauth2/v2.0/token');
  });

  it('prefers mail over the user principal name', async () => {
    const { fetch } = mockFetch(() => ({
      body: { mail: null, userPrincipalName: 'upn@example.com' },
    }));
    expect(await createMicrosoftProvider(endpoints, fetch).accountEmail('tok')).toBe(
      'upn@example.com',
    );
  });

  it('lists calendars across pages', async () => {
    const { fetch } = mockFetch((request) =>
      request.url.searchParams.has('$skip')
        ? { body: { value: [{ id: 'BBB=', name: 'Team' }] } }
        : {
            body: {
              value: [{ id: 'AAA=', name: 'Calendar', isDefaultCalendar: true }],
              '@odata.nextLink': `${endpoints.graph}/me/calendars?$skip=1`,
            },
          },
    );
    expect(await createMicrosoftProvider(endpoints, fetch).listCalendars('tok')).toEqual([
      primary,
      secondary,
    ]);
  });

  it('runs a delta sync on the primary calendar and maps events', async () => {
    const { fetch, requests } = mockFetch((request) =>
      request.url.searchParams.has('$skiptoken')
        ? {
            body: {
              value: [{ id: 'removed', '@removed': { reason: 'deleted' } }],
              '@odata.deltaLink': `${endpoints.graph}/me/calendarView/delta?$deltatoken=d1`,
            },
          }
        : {
            body: {
              value: [
                {
                  id: 'e1',
                  subject: 'Review',
                  isOrganizer: false,
                  start: { dateTime: '2026-01-02T10:00:00.0000000', timeZone: 'UTC' },
                  end: { dateTime: '2026-01-02T11:00:00.0000000', timeZone: 'UTC' },
                  onlineMeeting: { joinUrl: teams },
                  attendees: [
                    { type: 'required', emailAddress: { address: 'me@example.com' } },
                    { type: 'resource', emailAddress: { address: 'room@example.com' } },
                    {
                      type: 'optional',
                      status: { response: 'declined' },
                      emailAddress: { address: 'guest@other.io', name: 'Gus Guest' },
                    },
                  ],
                  responseStatus: { response: 'accepted' },
                },
                { id: 'e2', isCancelled: true },
                {
                  id: 'e3',
                  subject: 'Body link',
                  start: { dateTime: '2026-01-03T10:00:00.0000000' },
                  end: { dateTime: '2026-01-03T11:00:00.0000000' },
                  body: { content: '<a href="https://meet.google.com/abc-defg-hij">Join</a>' },
                  responseStatus: { response: 'declined' },
                },
              ],
              '@odata.nextLink': `${endpoints.graph}/me/calendarView/delta?$skiptoken=s1`,
            },
          },
    );

    const result = await createMicrosoftProvider(endpoints, fetch).syncEvents('tok', primary, full);

    expect(requests[0]?.url.pathname).toBe('/v1.0/me/calendarView/delta');
    expect(requests[0]?.url.searchParams.get('startDateTime')).toBe(window.from.toISOString());
    expect(requests[0]?.headers.get('prefer')).toContain('outlook.timezone="UTC"');
    expect(result.full).toBe(true);
    expect(result.state).toEqual({
      token: `${endpoints.graph}/me/calendarView/delta?$deltatoken=d1`,
      windowEnd: window.to.toISOString(),
    });
    expect(result.events).toEqual([
      {
        id: 'e1',
        cancelled: false,
        title: 'Review',
        start: new Date('2026-01-02T10:00:00Z'),
        end: new Date('2026-01-02T11:00:00Z'),
        link: { platform: 'teams', url: teams },
        isOrganizer: false,
        declined: false,
        guests: ['guest@other.io'],
        location: null,
        seriesKey: null,
        invitees: [
          { email: 'me@example.com', name: null, declined: false },
          { email: 'guest@other.io', name: 'Gus Guest', declined: true },
        ],
      },
      { id: 'e2', cancelled: true },
      expect.objectContaining({
        id: 'e3',
        link: { platform: 'meet', url: 'https://meet.google.com/abc-defg-hij' },
        declined: true,
      }),
      { id: 'removed', cancelled: true },
    ]);
  });

  it('follows the stored delta link for incremental syncs', async () => {
    const link = `${endpoints.graph}/me/calendarView/delta?$deltatoken=d1`;
    const { fetch, requests } = mockFetch(() => ({
      body: { value: [], '@odata.deltaLink': `${link}2` },
    }));
    const state = { token: link, windowEnd: '2026-02-01T00:00:00.000Z' };
    const result = await createMicrosoftProvider(endpoints, fetch).syncEvents('tok', primary, {
      ...full,
      state,
    });
    expect(requests[0]?.url.toString()).toBe(link);
    expect(result).toEqual({ events: [], full: false, state: { ...state, token: `${link}2` } });
  });

  it('polls a secondary calendar without keeping state', async () => {
    const { fetch, requests } = mockFetch(() => ({ body: { value: [] } }));
    const result = await createMicrosoftProvider(endpoints, fetch).syncEvents(
      'tok',
      secondary,
      full,
    );
    expect(requests[0]?.url.pathname).toBe('/v1.0/me/calendars/BBB%3D/calendarView');
    expect(result).toEqual({ events: [], full: true, state: null });
  });

  it('signals an expired delta link', async () => {
    const { fetch } = mockFetch(() => ({ status: 410, body: { error: { message: 'Gone' } } }));
    const state = {
      token: `${endpoints.graph}/me/calendarView/delta?$deltatoken=old`,
      windowEnd: '',
    };
    await expect(
      createMicrosoftProvider(endpoints, fetch).syncEvents('tok', primary, { ...full, state }),
    ).rejects.toBeInstanceOf(SyncExpiredError);
  });

  it('reads the body with its type and patches only the body, keeping a text body as text', async () => {
    const { fetch, requests } = mockFetch((request) =>
      request.method === 'GET'
        ? { body: { body: { contentType: 'text', content: 'Hello' } } }
        : { body: {} },
    );
    const provider = createMicrosoftProvider(endpoints, fetch);
    const body = await provider.readEventBody('tok', 'AAA=', 'evt/1');
    expect(body).toEqual({ content: 'Hello', html: false });
    await provider.writeEventBody('tok', 'AAA=', 'evt/1', { content: 'Hello!', html: false });
    expect(requests[1]?.method).toBe('PATCH');
    expect(requests[1]?.url.pathname).toContain('/me/calendars/AAA%3D/events/evt%2F1');
    expect(JSON.parse(requests[1]?.body ?? '')).toEqual({
      body: { contentType: 'text', content: 'Hello!' },
    });
  });
});
