import type { EventBody } from './minutes-block.js';
import type {
  CalendarInvitee,
  CalendarProviderId,
  CalendarSyncState,
  MeetingPlatform,
} from '@openminutes/db';

export interface MeetingLink {
  platform: MeetingPlatform;
  url: string;
}

export interface CancelledEvent {
  id: string;
  cancelled: true;
}

export interface ScheduledEvent {
  id: string;
  cancelled: false;
  title: string;
  start: Date;
  end: Date;
  link: MeetingLink | undefined;
  isOrganizer: boolean;
  declined: boolean;
  guests: string[];
  location: string | null;
  invitees: CalendarInvitee[];
  seriesKey: string | null;
}

export type CalendarEvent = CancelledEvent | ScheduledEvent;

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
}

export interface Credentials {
  clientId: string;
  clientSecret: string;
  tenant?: string | undefined;
}

export interface RemoteCalendar {
  externalId: string;
  name: string;
  isPrimary: boolean;
}

export type { EventBody } from './minutes-block.js';

export interface SyncRequest {
  state: CalendarSyncState | null;
  window: { from: Date; to: Date };
  accountEmail: string;
}

export interface SyncResult {
  events: CalendarEvent[];
  state: CalendarSyncState | null;
  full: boolean;
}

export interface AuthorizeRequest {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  extraScopes?: string[];
}

export interface CalendarProvider {
  readonly id: CalendarProviderId;
  authorizeUrl(credentials: Credentials, request: AuthorizeRequest): string;
  exchangeCode(
    credentials: Credentials,
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<TokenSet>;
  refresh(credentials: Credentials, refreshToken: string): Promise<TokenSet>;
  accountEmail(accessToken: string): Promise<string>;
  listCalendars(accessToken: string): Promise<RemoteCalendar[]>;
  syncEvents(
    accessToken: string,
    calendar: RemoteCalendar,
    request: SyncRequest,
  ): Promise<SyncResult>;
  readEventBody(accessToken: string, calendarId: string, eventId: string): Promise<EventBody>;
  writeEventBody(
    accessToken: string,
    calendarId: string,
    eventId: string,
    body: EventBody,
  ): Promise<void>;
}
