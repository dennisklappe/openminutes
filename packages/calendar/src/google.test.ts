import { describe, expect, it } from 'vitest';
import { endpointsFor } from './endpoints.js';
import { AuthRevokedError, CalendarApiError, SyncExpiredError } from './errors.js';
import { createGoogleProvider } from './google.js';
import { mockFetch } from './test-helpers.js';
import type { Credentials, SyncRequest } from './types.js';

const credentials: Credentials = { clientId: 'cid', clientSecret: 'secret' };
const endpoints = endpointsFor().google;
const calendar = { externalId: 'me@example.com', name: 'Me', isPrimary: true };
const window = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-15T00:00:00Z') };
const full: SyncRequest = { state: null, window, accountEmail: 'me@example.com' };

describe('google provider', () => {
  it('builds an offline authorization URL with PKCE', () => {
    const { fetch } = mockFetch(() => ({ body: {} }));
    const url = new URL(
      createGoogleProvider(endpoints, fetch).authorizeUrl(credentials, {
        redirectUri: 'https://openminutes.test/api/oauth/google/callback',
        state: 'st',
        codeChallenge: 'ch',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid',
      redirect_uri: 'https://openminutes.test/api/oauth/google/callback',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
  });

  it('adds the Gmail send scope on request and keeps earlier grants', () => {
    const { fetch } = mockFetch(() => ({ body: {} }));
    const url = new URL(
      createGoogleProvider(endpoints, fetch).authorizeUrl(credentials, {
        redirectUri: 'https://openminutes.test/api/oauth/google/callback',
        state: 'st',
        codeChallenge: 'ch',
        extraScopes: ['https://www.googleapis.com/auth/gmail.send'],
      }),
    );
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
    expect(url.searchParams.get('scope')).toContain('gmail.send');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  });

  it('exchanges a code and refreshes while keeping the refresh token', async () => {
    const { fetch, requests } = mockFetch((request) => ({
      body:
        request.form.get('grant_type') === 'authorization_code'
          ? { access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }
          : { access_token: 'a2', expires_in: 3600 },
    }));
    const provider = createGoogleProvider(endpoints, fetch);

    const first = await provider.exchangeCode(credentials, 'code', 'https://x/cb', 'verifier');
    expect(first).toMatchObject({ accessToken: 'a1', refreshToken: 'r1' });
    expect(requests[0]?.form.get('code_verifier')).toBe('verifier');
    expect(requests[0]?.form.get('client_secret')).toBe('secret');

    const second = await provider.refresh(credentials, 'r1');
    expect(second).toMatchObject({ accessToken: 'a2', refreshToken: 'r1' });
  });

  it('reports a revoked grant', async () => {
    const { fetch } = mockFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    await expect(
      createGoogleProvider(endpoints, fetch).refresh(credentials, 'r'),
    ).rejects.toBeInstanceOf(AuthRevokedError);
  });

  it('reads the account email', async () => {
    const { fetch, requests } = mockFetch(() => ({ body: { email: 'me@example.com' } }));
    expect(await createGoogleProvider(endpoints, fetch).accountEmail('tok')).toBe('me@example.com');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer tok');
  });

  it('lists calendars and drops holiday and free-busy ones', async () => {
    const { fetch } = mockFetch(() => ({
      body: {
        items: [
          { id: 'me@example.com', summary: 'Me', primary: true, accessRole: 'owner' },
          {
            id: 'x#holiday@group.v.calendar.google.com',
            summary: 'Holidays',
            accessRole: 'reader',
          },
          { id: 'busy', summary: 'Busy', accessRole: 'freeBusyReader' },
          { id: 'team', accessRole: 'writer' },
        ],
      },
    }));
    expect(await createGoogleProvider(endpoints, fetch).listCalendars('tok')).toEqual([
      { externalId: 'me@example.com', name: 'Me', isPrimary: true },
      { externalId: 'team', name: 'team', isPrimary: false },
    ]);
  });

  it('runs a full sync over several pages and maps events', async () => {
    const { fetch, requests } = mockFetch((request) =>
      request.url.searchParams.get('pageToken') === 'p2'
        ? {
            body: {
              items: [{ id: 'gone', status: 'cancelled' }],
              nextSyncToken: 'sync-1',
            },
          }
        : {
            body: {
              nextPageToken: 'p2',
              items: [
                {
                  id: 'e1',
                  summary: ' Planning ',
                  description: 'Notes',
                  start: { dateTime: '2026-01-02T10:00:00+01:00' },
                  end: { dateTime: '2026-01-02T11:00:00+01:00' },
                  conferenceData: {
                    entryPoints: [
                      { uri: 'tel:+31123' },
                      { uri: 'https://meet.google.com/abc-defg-hij' },
                    ],
                  },
                  location: ' Room 4 ',
                  organizer: { self: true },
                  attendees: [
                    { email: 'me@example.com', self: true, responseStatus: 'accepted' },
                    { email: 'room@resource.calendar.google.com', resource: true },
                    {
                      email: 'guest@other.io',
                      displayName: 'Gus Guest',
                      responseStatus: 'declined',
                    },
                  ],
                },
                {
                  id: 'e2',
                  start: { dateTime: '2026-01-03T10:00:00Z' },
                  end: { dateTime: '2026-01-03T11:00:00Z' },
                  attendees: [{ email: 'me@example.com', self: true, responseStatus: 'declined' }],
                },
                { id: 'allday', summary: 'Holiday', start: {}, end: {} },
              ],
            },
          },
    );

    const result = await createGoogleProvider(endpoints, fetch).syncEvents('tok', calendar, full);

    expect(requests).toHaveLength(2);
    const first = requests[0]?.url.searchParams;
    expect(first?.get('timeMin')).toBe(window.from.toISOString());
    expect(first?.get('timeMax')).toBe(window.to.toISOString());
    expect(first?.get('singleEvents')).toBe('true');
    expect(first?.get('showDeleted')).toBe('true');
    expect(result.full).toBe(true);
    expect(result.state).toEqual({ token: 'sync-1', windowEnd: window.to.toISOString() });
    expect(result.events).toEqual([
      {
        id: 'e1',
        cancelled: false,
        title: 'Planning',
        start: new Date('2026-01-02T09:00:00Z'),
        end: new Date('2026-01-02T10:00:00Z'),
        link: { platform: 'meet', url: 'https://meet.google.com/abc-defg-hij' },
        isOrganizer: true,
        declined: false,
        guests: ['guest@other.io'],
        location: 'Room 4',
        seriesKey: null,
        invitees: [
          { email: 'me@example.com', name: null, declined: false },
          { email: 'guest@other.io', name: 'Gus Guest', declined: true },
        ],
      },
      expect.objectContaining({
        id: 'e2',
        title: 'Untitled meeting',
        declined: true,
        isOrganizer: false,
      }),
      { id: 'allday', cancelled: true },
      { id: 'gone', cancelled: true },
    ]);
  });

  it('syncs incrementally with the stored token and keeps the window end', async () => {
    const { fetch, requests } = mockFetch(() => ({ body: { items: [], nextSyncToken: 'sync-2' } }));
    const state = { token: 'sync-1', windowEnd: '2026-02-01T00:00:00.000Z' };
    const result = await createGoogleProvider(endpoints, fetch).syncEvents('tok', calendar, {
      ...full,
      state,
    });
    const params = requests[0]?.url.searchParams;
    expect(params?.get('syncToken')).toBe('sync-1');
    expect(params?.has('timeMin')).toBe(false);
    expect(result).toEqual({ events: [], full: false, state: { ...state, token: 'sync-2' } });
  });

  it('signals an expired sync token', async () => {
    const { fetch } = mockFetch(() => ({ status: 410, body: { error: { message: 'Gone' } } }));
    const state = { token: 'old', windowEnd: window.to.toISOString() };
    await expect(
      createGoogleProvider(endpoints, fetch).syncEvents('tok', calendar, { ...full, state }),
    ).rejects.toBeInstanceOf(SyncExpiredError);
  });

  it('surfaces API errors with the message', async () => {
    const { fetch } = mockFetch(() => ({
      status: 403,
      body: { error: { message: 'API disabled' } },
    }));
    await expect(
      createGoogleProvider(endpoints, fetch).syncEvents('tok', calendar, full),
    ).rejects.toEqual(new CalendarApiError(403, 'API disabled'));
  });

  it('patches only the description and asks Google not to email the guests', async () => {
    const { fetch, requests } = mockFetch((request) =>
      request.method === 'GET' ? { body: { description: 'Line one<br>Line two' } } : { body: {} },
    );
    const provider = createGoogleProvider(endpoints, fetch);
    expect(await provider.readEventBody('tok', 'me@example.com', 'evt1')).toEqual({
      content: 'Line one<br>Line two',
      html: true,
    });
    await provider.writeEventBody('tok', 'me@example.com', 'evt1', { content: 'x', html: true });
    expect(requests[1]?.method).toBe('PATCH');
    expect(requests[1]?.url.searchParams.get('sendUpdates')).toBe('none');
    expect(JSON.parse(requests[1]?.body ?? '')).toEqual({ description: 'x' });
  });
});
