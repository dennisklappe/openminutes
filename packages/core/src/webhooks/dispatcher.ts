import { eq, sql, webhookDeliveries, webhookEndpoints, type Database } from '@openminutes/db';
import { decryptSecret } from '../crypto.js';
import { WEBHOOK_DISABLE_AFTER, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_DELAYS_MS } from './events.js';
import { signWebhook } from './sign.js';
import {
  pinnedTransport,
  WEBHOOK_RESPONSE_LIMIT,
  WEBHOOK_TIMEOUT_MS,
  type WebhookTransport,
} from './transport.js';
import { checkWebhookUrl, systemResolver, type Resolver } from './url-guard.js';

/** A row still `delivering` after this long belongs to a worker that died: it is taken over. */
export const WEBHOOK_STUCK_MS = 5 * 60_000;
export const WEBHOOK_POLL_MS = 5_000;
const BATCH = 10;

type Delivery = typeof webhookDeliveries.$inferSelect;

export interface DispatcherDeps {
  db: Database;
  /** The app secret the endpoint secrets are encrypted with. */
  secret: string;
  version: string;
  transport?: WebhookTransport;
  resolve?: Resolver;
  now?: () => Date;
  timeoutMs?: number;
  pollMs?: number;
}

/** The wait before the next attempt after `attempts` attempts failed. */
export const retryDelayMs = (attempts: number): number =>
  WEBHOOK_RETRY_DELAYS_MS[Math.min(attempts, WEBHOOK_RETRY_DELAYS_MS.length) - 1] ?? 0;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Sends queued webhook deliveries. Rows are claimed with `for update skip locked`, so several
 * workers can run side by side, and the outbox lives in Postgres, so a restart loses nothing.
 */
export class WebhookDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;
  private again = false;
  private readonly transport: WebhookTransport;
  private readonly resolve: Resolver;
  private readonly now: () => Date;

  constructor(private readonly deps: DispatcherDeps) {
    this.transport = deps.transport ?? pinnedTransport;
    this.resolve = deps.resolve ?? systemResolver;
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.nudge();
    }, this.deps.pollMs ?? WEBHOOK_POLL_MS);
    this.timer.unref();
    this.nudge();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running?.catch(() => undefined);
  }

  /** Looks for due deliveries now instead of at the next tick. */
  nudge(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.drain().finally(() => {
      this.running = undefined;
      if (this.again) {
        this.again = false;
        this.nudge();
      }
    });
    this.running.catch((error: unknown) => {
      console.error('webhook dispatcher failed', error);
    });
  }

  /** Sends every due delivery until none is left. Returns how many were attempted. */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const sent = await this.runOnce();
      total += sent;
      if (sent < BATCH) return total;
    }
  }

  /** Claims one batch of due deliveries and attempts each. */
  async runOnce(): Promise<number> {
    const claimed = await this.claim();
    await Promise.all(claimed.map((row) => this.attempt(row)));
    return claimed.length;
  }

  private async claim(): Promise<Delivery[]> {
    const now = this.now();
    const stuck = new Date(now.getTime() - WEBHOOK_STUCK_MS);
    const result = await this.deps.db.execute<{ id: string }>(sql`
      update ${webhookDeliveries} set status = 'delivering', last_attempt_at = ${now.toISOString()}::timestamptz
      where id in (
        select d.id from ${webhookDeliveries} d
        join ${webhookEndpoints} e on e.id = d.endpoint_id
        where (
          (d.status in ('pending', 'failed') and d.next_attempt_at <= ${now.toISOString()}::timestamptz)
          or (d.status = 'delivering' and d.last_attempt_at < ${stuck.toISOString()}::timestamptz)
        )
        and (e.active or d.kind <> 'event')
        order by d.next_attempt_at
        limit ${BATCH}
        for update of d skip locked
      )
      returning id`);
    const ids = result.rows.map((row) => row.id);
    if (ids.length === 0) return [];
    return this.deps.db
      .select()
      .from(webhookDeliveries)
      .where(sql`${webhookDeliveries.id} in ${ids}`);
  }

  private async attempt(delivery: Delivery): Promise<void> {
    const [endpoint] = await this.deps.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, delivery.endpointId));
    if (!endpoint) return;
    const started = this.now();
    const body = JSON.stringify(delivery.payload);
    let status: number | null = null;
    let error: string | null = null;
    const clock = performance.now();
    try {
      const check = await checkWebhookUrl(endpoint.url, {
        allowPrivate: endpoint.allowPrivate,
        resolve: this.resolve,
      });
      if (!check.ok) throw new Error(check.error);
      const [address] = check.addresses;
      if (!address) throw new Error('The host could not be found');
      const signingSecret = decryptSecret(endpoint.secretEncrypted, this.deps.secret);
      const timestamp = Math.floor(started.getTime() / 1000);
      const response = await this.transport({
        url: check.url,
        address,
        body,
        timeoutMs: this.deps.timeoutMs ?? WEBHOOK_TIMEOUT_MS,
        headers: {
          'content-type': 'application/json',
          'user-agent': `OpenMinutes-Webhooks/${this.deps.version}`,
          'x-openminutes-event': delivery.event,
          'x-openminutes-delivery': delivery.id,
          'x-openminutes-event-id': delivery.eventId,
          'x-openminutes-signature': signWebhook(signingSecret, body, timestamp),
        },
      });
      status = response.status;
      if (status < 200 || status >= 300) {
        error = `HTTP ${status}${response.body ? `: ${response.body}` : ''}`;
      }
    } catch (failure) {
      error = errorMessage(failure);
    }
    const durationMs = Math.round(performance.now() - clock);
    await this.record(delivery, {
      status,
      error: error?.slice(0, WEBHOOK_RESPONSE_LIMIT) ?? null,
      durationMs,
    });
  }

  private async record(
    delivery: Delivery,
    result: { status: number | null; error: string | null; durationMs: number },
  ): Promise<void> {
    const now = this.now();
    const attempts = delivery.attempts + 1;
    const ok = result.error === null;
    // A test ping is tried once: the person who sent it is looking at the result.
    const final = ok || delivery.kind === 'test' || attempts >= WEBHOOK_MAX_ATTEMPTS;
    const common = {
      attempts,
      lastAttemptAt: now,
      lastStatusCode: result.status,
      lastError: result.error,
      lastDurationMs: result.durationMs,
    };
    await this.deps.db
      .update(webhookDeliveries)
      .set(
        ok
          ? { ...common, status: 'succeeded', completedAt: now }
          : final
            ? { ...common, status: 'dead', completedAt: now }
            : {
                ...common,
                status: 'failed',
                nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
              },
      )
      .where(eq(webhookDeliveries.id, delivery.id));
    if (delivery.kind === 'test') return;
    if (ok) {
      await this.deps.db
        .update(webhookEndpoints)
        .set({ consecutiveFailures: 0, lastSuccessAt: now })
        .where(eq(webhookEndpoints.id, delivery.endpointId));
      return;
    }
    await this.deps.db
      .update(webhookEndpoints)
      .set({
        lastFailureAt: now,
        ...(final && {
          consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
        }),
      })
      .where(eq(webhookEndpoints.id, delivery.endpointId));
    if (final) {
      await this.deps.db
        .update(webhookEndpoints)
        .set({
          active: false,
          disabledReason: `Switched off after ${WEBHOOK_DISABLE_AFTER} deliveries in a row failed`,
          updatedAt: now,
        })
        .where(
          sql`${webhookEndpoints.id} = ${delivery.endpointId} and ${webhookEndpoints.active} and ${webhookEndpoints.consecutiveFailures} >= ${WEBHOOK_DISABLE_AFTER}`,
        );
    }
  }
}
