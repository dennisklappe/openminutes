import type { Endpoints } from './endpoints.js';
import { getJson, patchJson, postForm, type Fetch } from './http.js';
import { extractJoinLink } from './links.js';
import { parseTokens } from './oauth.js';
import type {
  CalendarEvent,
  CalendarProvider,
  Credentials,
  RemoteCalendar,
  SyncRequest,
  SyncResult,
} from './types.js';

const SCOPES = 'openid email offline_access User.Read Calendars.Read';
const PREFER = 'outlook.timezone="UTC", odata.maxpagesize=100';

interface GraphEvent {
  id: string;
  '@removed'?: unknown;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  seriesMasterId?: string | null;
  isAllDay?: boolean;
  subject?: string;
  start?: { dateTime: string };
  end?: { dateTime: string };
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  location?: { displayName?: string };
  body?: { content?: string };
  responseStatus?: { response?: string };
  attendees?: {
    type?: string;
    status?: { response?: string };
    emailAddress?: { address?: string; name?: string };
  }[];
}

interface GraphPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

const utc = (dateTime: string) => new Date(dateTime.endsWith('Z') ? dateTime : `${dateTime}Z`);

function toEvent(event: GraphEvent, accountEmail: string): CalendarEvent {
  if (event['@removed'] || event.isCancelled || !event.start || !event.end) {
    return { id: event.id, cancelled: true };
  }
  const link = extractJoinLink([
    event.onlineMeeting?.joinUrl,
    event.onlineMeetingUrl,
    event.location?.displayName,
    event.body?.content,
  ]);
  const self = accountEmail.toLowerCase();
  return {
    id: event.id,
    cancelled: false,
    title: event.subject?.trim() || 'Untitled meeting',
    start: utc(event.start.dateTime),
    end: utc(event.end.dateTime),
    link,
    seriesKey: event.seriesMasterId ? `microsoft:${event.seriesMasterId}` : null,
    isOrganizer: event.isOrganizer === true,
    declined: event.responseStatus?.response === 'declined',
    guests: (event.attendees ?? []).flatMap((a) => {
      const address = a.emailAddress?.address;
      return address && a.type !== 'resource' && address.toLowerCase() !== self ? [address] : [];
    }),
    location: event.location?.displayName?.trim() || null,
    invitees: (event.attendees ?? []).flatMap((a) => {
      const address = a.emailAddress?.address;
      if (!address || a.type === 'resource') return [];
      const name = a.emailAddress?.name?.trim();
      return [
        {
          email: address,
          name: name && name !== address ? name : null,
          declined: a.status?.response === 'declined',
        },
      ];
    }),
  };
}

export function createMicrosoftProvider(
  endpoints: Endpoints['microsoft'],
  fetchImpl: Fetch,
): CalendarProvider {
  const authority = (credentials: Credentials) =>
    `${endpoints.authority}/${credentials.tenant ?? 'common'}/oauth2/v2.0`;
  const tokenRequest = (credentials: Credentials, params: Record<string, string>) =>
    postForm<unknown>(fetchImpl, `${authority(credentials)}/token`, {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      ...params,
    });
  const get = <T>(accessToken: string, url: string) =>
    getJson<T>(fetchImpl, url, accessToken, { prefer: PREFER });

  async function collect(accessToken: string, firstUrl: string) {
    const events: GraphEvent[] = [];
    let deltaLink: string | undefined;
    for (let url: string | undefined = firstUrl; url;) {
      const page: GraphPage<GraphEvent> = await get(accessToken, url);
      events.push(...(page.value ?? []));
      deltaLink = page['@odata.deltaLink'];
      url = page['@odata.nextLink'];
    }
    return { events, deltaLink };
  }

  const eventUrl = (calendarId: string, eventId: string) =>
    `${endpoints.graph}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

  return {
    id: 'microsoft',

    authorizeUrl(credentials, request) {
      const url = new URL(`${authority(credentials)}/authorize`);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: request.redirectUri,
        response_type: 'code',
        response_mode: 'query',
        scope: [SCOPES, ...(request.extraScopes ?? [])].join(' '),
        state: request.state,
        code_challenge: request.codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.toString();
    },

    async exchangeCode(credentials, code, redirectUri, codeVerifier) {
      return parseTokens(
        await tokenRequest(credentials, {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      );
    },

    async refresh(credentials, refreshToken) {
      return parseTokens(
        await tokenRequest(credentials, {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        refreshToken,
      );
    },

    async accountEmail(accessToken) {
      const me = await get<{ mail?: string | null; userPrincipalName?: string }>(
        accessToken,
        `${endpoints.graph}/me?$select=mail,userPrincipalName`,
      );
      const email = me.mail ?? me.userPrincipalName;
      if (!email) throw new Error('Microsoft did not return an email address');
      return email;
    },

    async listCalendars(accessToken) {
      const calendars: RemoteCalendar[] = [];
      for (let url: string | undefined = `${endpoints.graph}/me/calendars`; url;) {
        const page: GraphPage<{ id: string; name?: string; isDefaultCalendar?: boolean }> =
          await get(accessToken, url);
        calendars.push(
          ...(page.value ?? []).map((c) => ({
            externalId: c.id,
            name: c.name ?? c.id,
            isPrimary: c.isDefaultCalendar === true,
          })),
        );
        url = page['@odata.nextLink'];
      }
      return calendars;
    },

    async syncEvents(accessToken, calendar, request: SyncRequest): Promise<SyncResult> {
      const { from, to } = request.window;
      const range = new URLSearchParams({
        startDateTime: from.toISOString(),
        endDateTime: to.toISOString(),
      }).toString();
      const view = calendar.isPrimary
        ? `${endpoints.graph}/me/calendarView/delta`
        : `${endpoints.graph}/me/calendars/${encodeURIComponent(calendar.externalId)}/calendarView`;
      const { events, deltaLink } = await collect(
        accessToken,
        request.state?.token ?? `${view}?${range}`,
      );
      return {
        events: events.map((event) => toEvent(event, request.accountEmail)),
        state:
          calendar.isPrimary && deltaLink
            ? { token: deltaLink, windowEnd: request.state?.windowEnd ?? to.toISOString() }
            : null,
        full: request.state === null,
      };
    },

    async readEventBody(accessToken, calendarId, eventId) {
      const event = await get<{ body?: { contentType?: string; content?: string } }>(
        accessToken,
        `${eventUrl(calendarId, eventId)}?$select=body`,
      );
      return {
        content: event.body?.content ?? '',
        html: event.body?.contentType?.toLowerCase() !== 'text',
      };
    },

    async writeEventBody(accessToken, calendarId, eventId, body) {
      await patchJson(fetchImpl, eventUrl(calendarId, eventId), accessToken, {
        body: { contentType: body.html ? 'html' : 'text', content: body.content },
      });
    },
  };
}
