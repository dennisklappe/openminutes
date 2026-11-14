import {
  and,
  inArray,
  lt,
  notInArray,
  sql,
  webhookDeliveries,
  type Database,
  type webhookEndpoints,
} from '@openminutes/db';
import { WEBHOOK_RETENTION_DAYS } from './events.js';

export type WebhookHealthState = 'healthy' | 'degraded' | 'failing' | 'disabled' | 'idle';

export interface WebhookHealth {
  state: WebhookHealthState;
  disabledReason: string | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  succeeded24h: number;
  failed24h: number;
  pending: number;
}

type Endpoint = Pick<
  typeof webhookEndpoints.$inferSelect,
  'id' | 'active' | 'disabledReason' | 'lastSuccessAt' | 'lastFailureAt'
>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** This many dead deliveries in a row make an endpoint failing. */
const FAILING_AFTER = 3;

/**
 * The health of each endpoint, from its deliveries. Test pings are left out: they say nothing
 * about the events the receiver gets.
 * - disabled: switched off, by a person or after too many failures
 * - idle: nothing sent yet
 * - failing: the last 3 finished deliveries are dead
 * - degraded: a delivery is waiting for a retry, or the last attempt failed
 * - healthy: otherwise
 */
export async function webhookHealth(
  db: Database,
  endpoints: readonly Endpoint[],
  now: Date,
): Promise<Map<string, WebhookHealth>> {
  const ids = endpoints.map((endpoint) => endpoint.id);
  const health = new Map<string, WebhookHealth>();
  if (ids.length === 0) return health;
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const counts = await db
    .select({
      endpointId: webhookDeliveries.endpointId,
      total: sql<number>`count(*)::int`,
      succeeded24h: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'succeeded' and ${webhookDeliveries.completedAt} >= ${since}::timestamptz)::int`,
      failed24h: sql<number>`count(*) filter (where ${webhookDeliveries.status} in ('failed', 'dead') and ${webhookDeliveries.lastAttemptAt} >= ${since}::timestamptz)::int`,
      pending: sql<number>`count(*) filter (where ${webhookDeliveries.status} in ('pending', 'delivering', 'failed'))::int`,
      retrying: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'failed')::int`,
    })
    .from(webhookDeliveries)
    .where(
      and(inArray(webhookDeliveries.endpointId, ids), notInArray(webhookDeliveries.kind, ['test'])),
    )
    .groupBy(webhookDeliveries.endpointId);
  const recent = await db.execute<{ endpoint_id: string; status: string; rank: string }>(sql`
    select endpoint_id, status, rank from (
      select endpoint_id, status,
        row_number() over (partition by endpoint_id order by last_attempt_at desc nulls last) as rank
      from ${webhookDeliveries}
      where endpoint_id in ${ids} and kind <> 'test' and last_attempt_at is not null
    ) ranked where rank <= ${FAILING_AFTER}`);
  for (const endpoint of endpoints) {
    const count = counts.find((row) => row.endpointId === endpoint.id);
    const last = recent.rows
      .filter((row) => row.endpoint_id === endpoint.id)
      .toSorted((a, b) => Number(a.rank) - Number(b.rank))
      .map((row) => row.status);
    let state: WebhookHealthState;
    if (!endpoint.active) state = 'disabled';
    else if (!count || count.total === 0) state = 'idle';
    else if (last.length >= FAILING_AFTER && last.every((status) => status === 'dead')) {
      state = 'failing';
    } else if (count.retrying > 0 || last[0] === 'failed' || last[0] === 'dead') {
      state = 'degraded';
    } else state = 'healthy';
    health.set(endpoint.id, {
      state,
      disabledReason: endpoint.disabledReason,
      lastSuccessAt: endpoint.lastSuccessAt,
      lastFailureAt: endpoint.lastFailureAt,
      succeeded24h: count?.succeeded24h ?? 0,
      failed24h: count?.failed24h ?? 0,
      pending: count?.pending ?? 0,
    });
  }
  return health;
}

/** Removes finished deliveries older than the retention. Returns how many were removed. */
export async function deleteOldWebhookDeliveries(db: Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * DAY_MS);
  const removed = await db
    .delete(webhookDeliveries)
    .where(
      and(
        lt(webhookDeliveries.createdAt, cutoff),
        inArray(webhookDeliveries.status, ['succeeded', 'dead']),
      ),
    )
    .returning({ id: webhookDeliveries.id });
  return removed.length;
}
