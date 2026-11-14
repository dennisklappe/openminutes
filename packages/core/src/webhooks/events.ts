import { webhookEvents, type MeetingPlatform, type WebhookEventName } from '@openminutes/db';

export { webhookEvents, type WebhookEventName };

/** The event of a test ping, sent with a sample meeting. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEventName, string> = {
  'meeting.transcribed': 'A meeting has a transcript, also after the speakers were run again.',
  'meeting.summarized': 'The AI summary of a meeting is ready. Manual edits do not send it.',
  'meeting.updated': 'The title of a transcribed meeting changed, by a person or automatically.',
  'meeting.participants_updated':
    'The participants or speaker names of a transcribed meeting changed. A burst of edits sends one delivery.',
  'meeting.deleted': 'A meeting was moved to the bin.',
};

/**
 * Events that a burst of edits can fire many times. Their deliveries wait this long, and a new
 * emit while one still waits updates that row instead of adding one.
 */
export const WEBHOOK_DEBOUNCED_EVENTS: readonly WebhookEventName[] = [
  'meeting.updated',
  'meeting.participants_updated',
];
export const WEBHOOK_DEBOUNCE_MS = 15_000;

export const isWebhookEvent = (value: string): value is WebhookEventName =>
  (webhookEvents as readonly string[]).includes(value);

/** Every delivery is tried this many times before it is given up as dead. */
export const WEBHOOK_MAX_ATTEMPTS = 6;
/** The wait after attempt 1, 2, 3, 4 and 5 failed. */
export const WEBHOOK_RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const;
/** An endpoint is switched off after this many deliveries in a row ended dead. */
export const WEBHOOK_DISABLE_AFTER = 10;
/** Delivery rows are kept this long for the log. */
export const WEBHOOK_RETENTION_DAYS = 30;

export interface WebhookMeeting {
  id: string;
  title: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  participants?: string[];
  status: string;
  company: string | null;
  platform: MeetingPlatform;
}

/** The exact JSON body of a delivery. It never carries transcript or summary text. */
export interface WebhookPayload {
  id: string;
  event: WebhookEventName | typeof WEBHOOK_TEST_EVENT;
  occurredAt: string;
  meeting: WebhookMeeting;
}

export const SAMPLE_MEETING_ID = '00000000-0000-4000-8000-000000000000';

export function sampleWebhookMeeting(now: Date): WebhookMeeting {
  const startedAt = new Date(now.getTime() - 30 * 60_000);
  return {
    id: SAMPLE_MEETING_ID,
    title: 'Test event from OpenMinutes',
    startedAt: startedAt.toISOString(),
    endedAt: now.toISOString(),
    durationSeconds: 30 * 60,
    participants: ['Ada Lovelace', 'Alan Turing'],
    status: 'transcribed',
    company: null,
    platform: 'meet',
  };
}
