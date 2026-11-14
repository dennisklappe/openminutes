import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  eq,
  meetings,
  participants,
  sql,
  webhookDeliveries,
  webhookEndpoints,
  type Database,
  type WebhookDeliveryKind,
  type WebhookEventName,
} from '@openminutes/db';
import {
  sampleWebhookMeeting,
  WEBHOOK_DEBOUNCE_MS,
  WEBHOOK_DEBOUNCED_EVENTS,
  WEBHOOK_TEST_EVENT,
  type WebhookMeeting,
  type WebhookPayload,
} from './events.js';
import { matchesWebhookFilter, type WebhookMeetingFacts } from './filter.js';

export interface MeetingSnapshot {
  meeting: WebhookMeeting;
  facts: WebhookMeetingFacts;
}

/** Reads what a payload says about a meeting. Undefined when the meeting is gone. */
export async function loadWebhookMeeting(
  db: Database,
  meetingId: string,
): Promise<MeetingSnapshot | undefined> {
  const [row] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!row) return undefined;
  const people = await db
    .select({
      name: participants.displayName,
      email: participants.email,
      inviteeEmails: participants.inviteeEmails,
    })
    .from(participants)
    .where(and(eq(participants.meetingId, meetingId), eq(participants.isBot, false)))
    .orderBy(asc(participants.joinedAt), asc(participants.displayName));
  const names = [...new Set(people.map((p) => p.name.trim()).filter(Boolean))];
  const durationSeconds =
    row.startedAt && row.endedAt
      ? Math.max(0, Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000))
      : null;
  return {
    meeting: {
      id: row.id,
      title: row.title,
      startedAt: row.startedAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      durationSeconds,
      ...(names.length > 0 && { participants: names }),
      status: row.status,
      company: row.company,
      platform: row.platform,
    },
    facts: {
      title: row.title,
      company: row.company,
      platform: row.platform,
      participants: people.flatMap((p) => [
        { name: p.name, email: p.email },
        ...p.inviteeEmails.map((email) => ({ name: p.name, email })),
      ]),
    },
  };
}

let defaultNudge: (() => void) | undefined;

/** Lets the process that runs the dispatcher hear about every queued delivery. */
export function setWebhookNudge(nudge: (() => void) | undefined): void {
  defaultNudge = nudge;
}

export interface EmitOptions {
  now?: Date;
  /** Called when at least one delivery was queued, so an in-process dispatcher can start now. */
  onQueued?: () => void;
}

/**
 * Queues one delivery per active endpoint that listens to the event and whose filter matches the
 * meeting. All copies share one event id, receivers dedupe on it. The debounced events wait a few
 * seconds and fold into a waiting delivery of the same event, endpoint and meeting. Never throws: a webhook must not
 * break the work that emitted it. Returns the number of queued deliveries.
 */
export async function emitWebhookEvent(
  db: Database,
  event: WebhookEventName,
  meetingId: string,
  options: EmitOptions = {},
): Promise<number> {
  try {
    const endpoints = await db
      .select({ id: webhookEndpoints.id, filter: webhookEndpoints.filter })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.active, true),
          sql`${webhookEndpoints.events} @> array[${event}]::text[]`,
        ),
      );
    if (endpoints.length === 0) return 0;
    const snapshot = await loadWebhookMeeting(db, meetingId);
    if (!snapshot) return 0;
    // Edits only matter once there is a transcript: a scheduled or running meeting changes a lot.
    if (WEBHOOK_DEBOUNCED_EVENTS.includes(event) && snapshot.meeting.status !== 'transcribed') {
      return 0;
    }
    const matching = endpoints.filter((endpoint) =>
      matchesWebhookFilter(endpoint.filter, snapshot.facts),
    );
    if (matching.length === 0) return 0;
    const now = options.now ?? new Date();
    const payload: WebhookPayload = {
      id: randomUUID(),
      event,
      occurredAt: now.toISOString(),
      meeting: snapshot.meeting,
    };
    if (WEBHOOK_DEBOUNCED_EVENTS.includes(event)) {
      const due = new Date(now.getTime() + WEBHOOK_DEBOUNCE_MS);
      for (const endpoint of matching) {
        // A delivery of the same event that has not been tried yet takes the newest state.
        const merged = await db
          .update(webhookDeliveries)
          .set({
            payload: sql`jsonb_set(jsonb_set(${webhookDeliveries.payload}, '{meeting}', ${JSON.stringify(payload.meeting)}::jsonb), '{occurredAt}', ${JSON.stringify(payload.occurredAt)}::jsonb)`,
            nextAttemptAt: due,
          })
          .where(
            and(
              eq(webhookDeliveries.endpointId, endpoint.id),
              eq(webhookDeliveries.event, event),
              eq(webhookDeliveries.meetingId, meetingId),
              eq(webhookDeliveries.kind, 'event'),
              eq(webhookDeliveries.status, 'pending'),
              eq(webhookDeliveries.attempts, 0),
            ),
          )
          .returning({ id: webhookDeliveries.id });
        if (merged.length > 0) continue;
        await db.insert(webhookDeliveries).values({
          endpointId: endpoint.id,
          event,
          eventId: payload.id,
          meetingId,
          payload: { ...payload },
          kind: 'event',
          nextAttemptAt: due,
          createdAt: now,
        });
      }
      (options.onQueued ?? defaultNudge)?.();
      return matching.length;
    }
    await db.insert(webhookDeliveries).values(
      matching.map((endpoint) => ({
        endpointId: endpoint.id,
        event,
        eventId: payload.id,
        meetingId,
        payload: { ...payload },
        kind: 'event' as const,
        nextAttemptAt: now,
        createdAt: now,
      })),
    );
    (options.onQueued ?? defaultNudge)?.();
    return matching.length;
  } catch (error) {
    console.error(`webhook event ${event} for meeting ${meetingId} was not queued`, error);
    return 0;
  }
}

/** Emits the event for several meetings, one event id each. */
export async function emitWebhookEvents(
  db: Database,
  event: WebhookEventName,
  meetingIds: readonly string[],
  options: EmitOptions = {},
): Promise<void> {
  for (const meetingId of meetingIds) await emitWebhookEvent(db, event, meetingId, options);
}

async function queueOne(
  db: Database,
  endpointId: string,
  payload: WebhookPayload,
  kind: WebhookDeliveryKind,
  meetingId: string | null,
  now: Date,
) {
  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      endpointId,
      event: payload.event,
      eventId: payload.id,
      meetingId,
      payload: { ...payload },
      kind,
      nextAttemptAt: now,
      createdAt: now,
    })
    .returning();
  if (!row) throw new Error('The webhook delivery was not queued');
  return row;
}

/** Queues a `webhook.test` ping with the sample meeting. */
export function queueWebhookTest(db: Database, endpointId: string, now = new Date()) {
  const payload: WebhookPayload = {
    id: randomUUID(),
    event: WEBHOOK_TEST_EVENT,
    occurredAt: now.toISOString(),
    meeting: sampleWebhookMeeting(now),
  };
  return queueOne(db, endpointId, payload, 'test', null, now);
}

/**
 * Queues the real shape of an event for an existing meeting, ignoring the endpoint's filter and
 * events, so a receiver can be tried with real ids. Undefined when the meeting does not exist.
 */
export async function queueWebhookTestEvent(
  db: Database,
  endpointId: string,
  event: WebhookEventName,
  meetingId: string,
  now = new Date(),
) {
  const snapshot = await loadWebhookMeeting(db, meetingId);
  if (!snapshot) return undefined;
  const payload: WebhookPayload = {
    id: randomUUID(),
    event,
    occurredAt: now.toISOString(),
    meeting: snapshot.meeting,
  };
  return queueOne(db, endpointId, payload, 'test', meetingId, now);
}

/** Sends a delivery again as a new row with the same payload and event id. The old row stays. */
export async function replayWebhookDelivery(
  db: Database,
  delivery: typeof webhookDeliveries.$inferSelect,
  now = new Date(),
) {
  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      endpointId: delivery.endpointId,
      event: delivery.event,
      eventId: delivery.eventId,
      meetingId: delivery.meetingId,
      payload: delivery.payload,
      kind: 'replay',
      nextAttemptAt: now,
      createdAt: now,
    })
    .returning();
  if (!row) throw new Error('The webhook delivery was not queued');
  return row;
}
