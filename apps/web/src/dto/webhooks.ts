export type WebhookEventName =
  | 'meeting.transcribed'
  | 'meeting.summarized'
  | 'meeting.updated'
  | 'meeting.participants_updated'
  | 'meeting.deleted';
export type WebhookPlatform = 'meet' | 'teams' | 'whereby' | 'recording' | 'imported';

/** Every given criterion must hold, an absent or empty one is no limit. */
export interface WebhookFilter {
  titleContains?: string[];
  titleNotContains?: string[];
  participantContains?: string[];
  companies?: string[];
  platforms?: WebhookPlatform[];
}

export type WebhookHealthState = 'healthy' | 'degraded' | 'failing' | 'disabled' | 'idle';

export interface WebhookHealthDto {
  state: WebhookHealthState;
  disabledReason: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  succeeded24h: number;
  failed24h: number;
  /** Deliveries waiting to be sent or retried. */
  pending: number;
}

export interface WebhookDto {
  id: string;
  name: string;
  url: string;
  events: WebhookEventName[];
  filter: WebhookFilter;
  allowPrivate: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** The first 10 characters of the signing secret, to recognise it. */
  secretPrefix: string;
  health: WebhookHealthDto;
}

/** Create takes name, url and events; a PATCH takes any of the fields. */
export interface WebhookInput {
  name?: string;
  url?: string;
  events?: WebhookEventName[];
  filter?: WebhookFilter;
  allowPrivate?: boolean;
  active?: boolean;
}

/** The secret is in this response only, it cannot be read again. */
export interface WebhookCreatedDto {
  webhook: WebhookDto;
  secret: string;
}

export interface WebhookSecretDto {
  secret: string;
}

export type DeliveryStatus = 'pending' | 'delivering' | 'succeeded' | 'failed' | 'dead';
export type DeliveryKind = 'event' | 'test' | 'replay';

export interface DeliveryDto {
  id: string;
  event: WebhookEventName | 'webhook.test';
  eventId: string;
  meetingId: string | null;
  kind: DeliveryKind;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  /** Null once the delivery is finished (succeeded or dead). */
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  createdAt: string;
  completedAt: string | null;
  /** The exact body that is sent. */
  payload: unknown;
}

export interface DeliveryQueuedDto {
  delivery: DeliveryDto;
}

export interface WebhookTestEventInput {
  event: WebhookEventName;
  meetingId?: string;
}

export interface WebhookEventsDto {
  events: { id: WebhookEventName; description: string }[];
}
