import {
  checkWebhookUrl,
  encryptSecret,
  generateWebhookSecret,
  queueWebhookTest,
  queueWebhookTestEvent,
  replayWebhookDelivery,
  WEBHOOK_EVENT_DESCRIPTIONS,
  WEBHOOK_MAX_ATTEMPTS,
  webhookFilterSchema,
  webhookHealth,
  type Resolver,
} from '@openminutes/core';
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  lt,
  meetings,
  webhookDeliveries,
  webhookDeliveryStatuses,
  webhookEndpoints,
  webhookEvents,
  type Database,
} from '@openminutes/db';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type {
  DeliveryDto,
  DeliveryQueuedDto,
  WebhookCreatedDto,
  WebhookDto,
  WebhookEventsDto,
  WebhookSecretDto,
} from '../dto.js';

const MAX_ENDPOINTS = 50;
const MAX_DELIVERY_PAGE = 200;

const fields = {
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(2048),
  events: z
    .array(z.enum(webhookEvents))
    .min(1)
    .transform((events) => [...new Set(events)]),
  filter: webhookFilterSchema,
  allowPrivate: z.boolean(),
  active: z.boolean(),
};
const createInput = z.strictObject({
  name: fields.name,
  url: fields.url,
  events: fields.events,
  filter: fields.filter.optional(),
  allowPrivate: fields.allowPrivate.optional(),
  active: fields.active.optional(),
});
const updateInput = z.strictObject({
  name: fields.name.optional(),
  url: fields.url.optional(),
  events: fields.events.optional(),
  filter: fields.filter.optional(),
  allowPrivate: fields.allowPrivate.optional(),
  active: fields.active.optional(),
});
const testEventInput = z.strictObject({
  event: z.enum(webhookEvents),
  meetingId: z.uuid().optional(),
});
const deliveryQuery = z.object({
  status: z.enum(webhookDeliveryStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_DELIVERY_PAGE).default(50),
  before: z.iso.datetime({ offset: true }).optional(),
});

type Endpoint = typeof webhookEndpoints.$inferSelect;
type Delivery = typeof webhookDeliveries.$inferSelect;

const iso = (date: Date | null) => date?.toISOString() ?? null;

export const toDeliveryDto = (row: Delivery): DeliveryDto => ({
  id: row.id,
  event: row.event as DeliveryDto['event'],
  eventId: row.eventId,
  meetingId: row.meetingId,
  kind: row.kind,
  status: row.status,
  attempts: row.attempts,
  maxAttempts: row.kind === 'test' ? 1 : WEBHOOK_MAX_ATTEMPTS,
  nextAttemptAt:
    row.status === 'succeeded' || row.status === 'dead' ? null : row.nextAttemptAt.toISOString(),
  lastAttemptAt: iso(row.lastAttemptAt),
  lastStatusCode: row.lastStatusCode,
  lastError: row.lastError,
  lastDurationMs: row.lastDurationMs,
  createdAt: row.createdAt.toISOString(),
  completedAt: iso(row.completedAt),
  payload: row.payload,
});

export interface WebhookRouteDeps {
  db: Database;
  secret: string;
  /** DNS for the URL check, the system resolver by default. */
  webhookResolver?: Resolver;
}

/**
 * Outgoing webhooks. Cookie sessions only: an API key cannot add a receiver or read a secret, see
 * keyForbidden. Deliveries are queued here and sent by the worker.
 */
export function webhookSettingsRoutes(deps: WebhookRouteDeps): Hono {
  const { db } = deps;
  const routes = new Hono();

  const toDtos = async (rows: Endpoint[]): Promise<WebhookDto[]> => {
    const health = await webhookHealth(db, rows, new Date());
    return rows.map((row) => {
      const h = health.get(row.id);
      return {
        id: row.id,
        name: row.name,
        url: row.url,
        events: row.events,
        filter: row.filter,
        allowPrivate: row.allowPrivate,
        active: row.active,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        secretPrefix: row.secretPrefix,
        health: {
          state: h?.state ?? (row.active ? 'idle' : 'disabled'),
          disabledReason: row.disabledReason,
          lastSuccessAt: iso(row.lastSuccessAt),
          lastFailureAt: iso(row.lastFailureAt),
          succeeded24h: h?.succeeded24h ?? 0,
          failed24h: h?.failed24h ?? 0,
          pending: h?.pending ?? 0,
        },
      };
    });
  };
  const toDto = async (row: Endpoint) => (await toDtos([row]))[0] as WebhookDto;

  const find = async (c: Context): Promise<Endpoint | undefined> => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return undefined;
    const [row] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id.data));
    return row;
  };
  const notFound = (c: Context) => c.json({ error: 'Webhook not found' }, 404);
  const checkUrl = (url: string, allowPrivate: boolean) =>
    checkWebhookUrl(url, {
      allowPrivate,
      ...(deps.webhookResolver && { resolve: deps.webhookResolver }),
    });

  routes.get('/events', (c) =>
    c.json<WebhookEventsDto>({
      events: webhookEvents.map((id) => ({ id, description: WEBHOOK_EVENT_DESCRIPTIONS[id] })),
    }),
  );

  routes.get('/', async (c) => {
    const rows = await db.select().from(webhookEndpoints).orderBy(asc(webhookEndpoints.createdAt));
    return c.json<WebhookDto[]>(await toDtos(rows));
  });

  routes.post('/', async (c) => {
    const body = createInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'Give the webhook a name, a URL and at least one event' }, 400);
    }
    const count = (await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints)).length;
    if (count >= MAX_ENDPOINTS) {
      return c.json({ error: `Delete a webhook first, ${MAX_ENDPOINTS} is the maximum` }, 409);
    }
    const { name, url, events, filter, allowPrivate = false, active = true } = body.data;
    const check = await checkUrl(url, allowPrivate);
    if (!check.ok) return c.json({ error: check.error }, 400);
    const { secret, prefix } = generateWebhookSecret();
    const [row] = await db
      .insert(webhookEndpoints)
      .values({
        name,
        url: check.url.toString(),
        events,
        filter: filter ?? {},
        allowPrivate,
        active,
        secretEncrypted: encryptSecret(secret, deps.secret),
        secretPrefix: prefix,
      })
      .returning();
    if (!row) throw new Error('Webhook was not created');
    return c.json<WebhookCreatedDto>({ webhook: await toDto(row), secret }, 201);
  });

  routes.get('/:id', async (c) => {
    const row = await find(c);
    return row ? c.json<WebhookDto>(await toDto(row)) : notFound(c);
  });

  routes.patch('/:id', async (c) => {
    const row = await find(c);
    if (!row) return notFound(c);
    const body = updateInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid webhook' }, 400);
    const change = body.data;
    const url = change.url ?? row.url;
    const allowPrivate = change.allowPrivate ?? row.allowPrivate;
    let cleanUrl = row.url;
    if (change.url !== undefined || change.allowPrivate !== undefined) {
      const check = await checkUrl(url, allowPrivate);
      if (!check.ok) return c.json({ error: check.error }, 400);
      cleanUrl = check.url.toString();
    }
    const reactivated = change.active === true && !row.active;
    const [updated] = await db
      .update(webhookEndpoints)
      .set({
        ...(change.name !== undefined && { name: change.name }),
        ...(change.events !== undefined && { events: change.events }),
        ...(change.filter !== undefined && { filter: change.filter }),
        ...(change.active !== undefined && { active: change.active }),
        url: cleanUrl,
        allowPrivate,
        ...(reactivated && { disabledReason: null, consecutiveFailures: 0 }),
        ...(change.active === false && { disabledReason: null }),
        updatedAt: new Date(),
      })
      .where(eq(webhookEndpoints.id, row.id))
      .returning();
    if (!updated) return notFound(c);
    return c.json<WebhookDto>(await toDto(updated));
  });

  routes.delete('/:id', async (c) => {
    const row = await find(c);
    if (!row) return notFound(c);
    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, row.id));
    return c.json({ ok: true });
  });

  routes.post('/:id/rotate-secret', async (c) => {
    const row = await find(c);
    if (!row) return notFound(c);
    const { secret, prefix } = generateWebhookSecret();
    await db
      .update(webhookEndpoints)
      .set({
        secretEncrypted: encryptSecret(secret, deps.secret),
        secretPrefix: prefix,
        updatedAt: new Date(),
      })
      .where(eq(webhookEndpoints.id, row.id));
    return c.json<WebhookSecretDto>({ secret });
  });

  routes.post('/:id/test', async (c) => {
    const row = await find(c);
    if (!row) return notFound(c);
    const delivery = await queueWebhookTest(db, row.id);
    return c.json<DeliveryQueuedDto>({ delivery: toDeliveryDto(delivery) }, 202);
  });

  routes.post('/:id/test-event', async (c) => {
    const row = await find(c);
    if (!row) return notFound(c);
    const body = testEventInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Pick an event' }, 400);
    let meetingId = body.data.meetingId;
    if (!meetingId) {
      const [latest] = await db
        .select({ id: meetings.id })
        .from(meetings)
        .where(and(eq(meetings.status, 'transcribed'), isNull(meetings.deletedAt)))
        .orderBy(desc(meetings.createdAt))
        .limit(1);
      meetingId = latest?.id;
    }
    const delivery = meetingId
      ? await queueWebhookTestEvent(db, row.id, body.data.event, meetingId)
      : undefined;
    if (!delivery) return c.json({ error: 'Meeting not found' }, 404);
    return c.json<DeliveryQueuedDto>({ delivery: toDeliveryDto(delivery) }, 202);
  });

  routes.get('/:id/deliveries', async (c) => {
    const row = await find(c);
    if (!row) return notFound(c);
    const query = deliveryQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: 'Invalid filter' }, 400);
    const { status, limit, before } = query.data;
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.endpointId, row.id),
          status === undefined ? undefined : eq(webhookDeliveries.status, status),
          before === undefined ? undefined : lt(webhookDeliveries.createdAt, new Date(before)),
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(limit);
    return c.json<DeliveryDto[]>(rows.map(toDeliveryDto));
  });

  routes.post('/:id/deliveries/:deliveryId/replay', async (c) => {
    const row = await find(c);
    const deliveryId = z.uuid().safeParse(c.req.param('deliveryId'));
    if (!row || !deliveryId.success) return c.json({ error: 'Delivery not found' }, 404);
    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.id, deliveryId.data), eq(webhookDeliveries.endpointId, row.id)),
      );
    if (!delivery) return c.json({ error: 'Delivery not found' }, 404);
    const replay = await replayWebhookDelivery(db, delivery);
    return c.json<DeliveryQueuedDto>({ delivery: toDeliveryDto(replay) }, 202);
  });

  return routes;
}
