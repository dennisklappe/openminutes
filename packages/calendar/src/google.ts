import type { CalendarSyncState } from '@openminutes/db';
import type { Endpoints } from './endpoints.js';
import { getJson, patchJson, postForm, type Fetch } from './http.js';
import { extractJoinLink } from './links.js';
import { looksLikeHtml } from './minutes-block.js';
import { parseTokens } from './oauth.js';
import type {
  CalendarEvent,
  CalendarProvider,
  RemoteCalendar,
  SyncRequest,
  SyncResult,
} from './types.js';

const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.readonly';
const PAGE_SIZE = '250';

interface GoogleEvent {
  id: string;
  status?: string;
  recurringEventId?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  conferenceData?: { entryPoints?: { uri?: string }[] };
  organizer?: { self?: boolean };
  attendees?: {
    email?: string;
    displayName?: string;
    self?: boolean;
    resource?: boolean;
    responseStatus?: string;
  }[];
}

interface EventsPage {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface CalendarListPage {
  items?: { id: string; summary?: string; primary?: boolean; accessRole?: string }[];
  nextPageToken?: string;
}

function toEvent(event: GoogleEvent): CalendarEvent {
  if (event.status === 'cancelled' || !event.start?.dateTime || !event.end?.dateTime) {
    return { id: event.id, cancelled: true };
  }
  const attendees = event.attendees ?? [];
  const link = extractJoinLink([
    event.hangoutLink,
    ...(event.conferenceData?.entryPoints ?? []).map((entry) => entry.uri),
    event.location,
    event.description,
  ]);
  return {
    id: event.id,
    cancelled: false,
    title: event.summary?.trim() || 'Untitled meeting',
    start: new Date(event.start.dateTime),
    end: new Date(event.end.dateTime),
    link,
    seriesKey: event.recurringEventId ? `google:${event.recurringEventId}` : null,
    isOrganizer: event.organizer?.self === true,
    declined: attendees.some((a) => a.self && a.responseStatus === 'declined'),
    guests: attendees.flatMap((a) => (a.email && !a.self && !a.resource ? [a.email] : [])),
    location: event.location?.trim() || null,
    invitees: attendees.flatMap((a) =>
      a.email && !a.resource
        ? [
            {
              email: a.email,
              name: a.displayName?.trim() || null,
              declined: a.responseStatus === 'declined',
            },
          ]
        : [],
    ),
  };
}

export function createGoogleProvider(
  endpoints: Endpoints['google'],
  fetchImpl: Fetch,
): CalendarProvider {
  const tokenRequest = (params: Record<string, string>) =>
    postForm<unknown>(fetchImpl, endpoints.token, params);

  async function pages<T extends { nextPageToken?: string }>(
    accessToken: string,
    url: URL,
  ): Promise<T[]> {
    const results: T[] = [];
    let pageToken: string | undefined;
    do {
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await getJson<T>(fetchImpl, url.toString(), accessToken);
      results.push(page);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return results;
  }

  const eventUrl = (calendarId: string, eventId: string) =>
    `${endpoints.api}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

  return {
    id: 'google',

    authorizeUrl(credentials, request) {
      const url = new URL(endpoints.auth);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: request.redirectUri,
        response_type: 'code',
        scope: [SCOPES, ...(request.extraScopes ?? [])].join(' '),
        include_granted_scopes: 'true',
        access_type: 'offline',
        prompt: 'consent',
        state: request.state,
        code_challenge: request.codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.toString();
    },

    async exchangeCode(credentials, code, redirectUri, codeVerifier) {
      return parseTokens(
        await tokenRequest({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }),
      );
    },

    async refresh(credentials, refreshToken) {
      return parseTokens(
        await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }),
        refreshToken,
      );
    },

    async accountEmail(accessToken) {
      const { email } = await getJson<{ email?: string }>(
        fetchImpl,
        endpoints.userinfo,
        accessToken,
      );
      if (!email) throw new Error('Google did not return an email address');
      return email;
    },

    async listCalendars(accessToken) {
      const url = new URL(`${endpoints.api}/users/me/calendarList`);
      const all = await pages<CalendarListPage>(accessToken, url);
      return all
        .flatMap((page) => page.items ?? [])
        .filter(
          (c) =>
            c.accessRole !== 'freeBusyReader' &&
            !c.id.endsWith('#holiday@group.v.calendar.google.com'),
        )
        .map((c): RemoteCalendar => ({
          externalId: c.id,
          name: c.summary ?? c.id,
          isPrimary: c.primary === true,
        }));
    },

    async syncEvents(accessToken, calendar, request: SyncRequest): Promise<SyncResult> {
      const url = new URL(
        `${endpoints.api}/calendars/${encodeURIComponent(calendar.externalId)}/events`,
      );
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('showDeleted', 'true');
      url.searchParams.set('maxResults', PAGE_SIZE);
      if (request.state) {
        url.searchParams.set('syncToken', request.state.token);
      } else {
        url.searchParams.set('timeMin', request.window.from.toISOString());
        url.searchParams.set('timeMax', request.window.to.toISOString());
      }

      const all = await pages<EventsPage>(accessToken, url);
      const token = all.at(-1)?.nextSyncToken;
      if (!token) throw new Error('Google did not return a sync token');
      const state: CalendarSyncState = {
        token,
        windowEnd: request.state?.windowEnd ?? request.window.to.toISOString(),
      };
      return {
        events: all.flatMap((page) => page.items ?? []).map(toEvent),
        state,
        full: request.state === null,
      };
    },

    async readEventBody(accessToken, calendarId, eventId) {
      const event = await getJson<{ description?: string }>(
        fetchImpl,
        eventUrl(calendarId, eventId),
        accessToken,
      );
      const content = event.description ?? '';
      return { content, html: content === '' || looksLikeHtml(content) };
    },

    async writeEventBody(accessToken, calendarId, eventId, body) {
      const url = new URL(eventUrl(calendarId, eventId));
      url.searchParams.set('sendUpdates', 'none');
      await patchJson(fetchImpl, url.toString(), accessToken, { description: body.content });
    },
  };
}
