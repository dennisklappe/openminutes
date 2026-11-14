import {
  eq,
  meetings,
  participants,
  webhookDeliveries,
  webhookEndpoints,
  type WebhookEventName,
  type WebhookFilter,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { binMeetings, purgeMeetings, restoreMeetings } from '../bin.js';
import { encryptSecret } from '../crypto.js';
import { WebhookDispatcher, WEBHOOK_STUCK_MS } from './dispatcher.js';
import { emitWebhookEvent, queueWebhookTest, replayWebhookDelivery } from './emit.js';
import { WEBHOOK_DEBOUNCE_MS, WEBHOOK_MAX_ATTEMPTS, type WebhookPayload } from './events.js';
import { deleteOldWebhookDeliveries, webhookHealth } from './health.js';
import { verifyWebhookSignature } from './sign.js';
import type { WebhookRequest, WebhookResponse } from './transport.js';
import type { Resolver } from './url-guard.js';

const APP_SECRET = 'a-long-enough-test-secret';
const SIGNING = 'whsec_signing';
const PUBLIC_IP = '93.184.215.14';
const MINUTE = 60_000;

describe('webhooks', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let clock: Date;
  let sent: WebhookRequest[];
  let answer: (request: WebhookRequest) => Promise<WebhookResponse>;
  let resolve: Resolver;

  const dispatcher = () =>
    new WebhookDispatcher({
      db: test.db,
      secret: APP_SECRET,
      version: '9.9.9',
      now: () => clock,
      resolve: (host) => resolve(host),
      transport: (request) => {
        sent.push(request);
        return answer(request);
      },
    });
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };

  async function endpoint(
    values: Partial<typeof webhookEndpoints.$inferInsert> & { events?: WebhookEventName[] } = {},
  ) {
    const [row] = await test.db
      .insert(webhookEndpoints)
      .values({
        name: 'Receiver',
        url: 'https://hooks.example.test/in',
        secretEncrypted: encryptSecret(SIGNING, APP_SECRET),
        secretPrefix: SIGNING.slice(0, 10),
        events: ['meeting.transcribed', 'meeting.summarized', 'meeting.deleted'],
        ...values,
      })
      .returning();
    if (!row) throw new Error('no endpoint');
    return row;
  }

  async function meeting(values: Partial<typeof meetings.$inferInsert> = {}) {
    const [row] = await test.db
      .insert(meetings)
      .values({
        title: 'Weekly sync',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'transcribed',
        startedAt: new Date('2026-11-01T10:00:00Z'),
        endedAt: new Date('2026-11-01T10:30:00Z'),
        ...values,
      })
      .returning();
    if (!row) throw new Error('no meeting');
    await test.db.insert(participants).values([
      { meetingId: row.id, displayName: 'Ada Lovelace', email: 'ada@acme.test' },
      { meetingId: row.id, displayName: 'OpenMinutes', isBot: true },
    ]);
    return row;
  }

  const deliveries = () => test.db.select().from(webhookDeliveries);

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());
  beforeEach(async () => {
    await test.db.delete(webhookEndpoints);
    await test.db.delete(meetings);
    clock = new Date('2026-11-14T12:00:00Z');
    sent = [];
    answer = () => Promise.resolve({ status: 200, body: 'ok' });
    resolve = () => Promise.resolve([{ address: PUBLIC_IP, family: 4 }]);
  });

  describe('emitting', () => {
    it('queues one row per matching endpoint with a payload without transcript text', async () => {
      const a = await endpoint();
      const b = await endpoint({ filter: { titleContains: ['sync'] } });
      await endpoint({ filter: { titleContains: ['standup'] } });
      await endpoint({ events: ['meeting.deleted'] });
      await endpoint({ active: false });
      const m = await meeting({ company: 'Acme' });
      let nudged = 0;
      const queued = await emitWebhookEvent(test.db, 'meeting.transcribed', m.id, {
        now: clock,
        onQueued: () => (nudged += 1),
      });
      expect(queued).toBe(2);
      expect(nudged).toBe(1);
      const rows = await deliveries();
      expect(rows.map((row) => row.endpointId).sort()).toEqual([a.id, b.id].sort());
      expect(new Set(rows.map((row) => row.eventId)).size).toBe(1);
      expect(rows[0]?.payload).toEqual({
        id: rows[0]?.eventId,
        event: 'meeting.transcribed',
        occurredAt: clock.toISOString(),
        meeting: {
          id: m.id,
          title: 'Weekly sync',
          startedAt: '2026-11-01T10:00:00.000Z',
          endedAt: '2026-11-01T10:30:00.000Z',
          durationSeconds: 1800,
          participants: ['Ada Lovelace'],
          status: 'transcribed',
          company: 'Acme',
          platform: 'meet',
        },
      });
    });

    it('matches participant emails, which the payload does not carry', async () => {
      await endpoint({ filter: { participantContains: ['@acme.test'] } satisfies WebhookFilter });
      const m = await meeting();
      expect(await emitWebhookEvent(test.db, 'meeting.transcribed', m.id)).toBe(1);
      expect(JSON.stringify((await deliveries())[0]?.payload)).not.toContain('acme.test');
    });

    it('never throws into the caller', async () => {
      await endpoint();
      expect(await emitWebhookEvent(test.db, 'meeting.transcribed', 'not-a-uuid')).toBe(0);
    });

    it('sends meeting.deleted when a meeting is binned, not again on purge', async () => {
      await endpoint();
      const m = await meeting();
      expect(await binMeetings(test.db, [m.id], clock)).toEqual([m.id]);
      expect(await binMeetings(test.db, [m.id], clock)).toEqual([]);
      let rows = await deliveries();
      expect(rows.map((row) => [row.event, row.meetingId])).toEqual([['meeting.deleted', m.id]]);
      await restoreMeetings(test.db, [m.id]);
      await binMeetings(test.db, [m.id], clock);
      rows = await deliveries();
      expect(rows).toHaveLength(2);
      const storage = { delete: () => Promise.resolve() } as never;
      await purgeMeetings({ db: test.db, storage }, [m.id]).catch(() => undefined);
      expect(await deliveries()).toHaveLength(2);
    });

    it('folds a burst of edits into one delivery, only for transcribed meetings', async () => {
      await endpoint({ events: ['meeting.participants_updated', 'meeting.updated'] });
      const m = await meeting();
      await emitWebhookEvent(test.db, 'meeting.participants_updated', m.id, { now: clock });
      await test.db
        .update(participants)
        .set({ displayName: 'Ada King' })
        .where(eq(participants.meetingId, m.id));
      advance(5_000);
      await emitWebhookEvent(test.db, 'meeting.participants_updated', m.id, { now: clock });
      await emitWebhookEvent(test.db, 'meeting.updated', m.id, { now: clock });
      const rows = await deliveries();
      expect(rows).toHaveLength(2);
      const people = rows.find((row) => row.event === 'meeting.participants_updated');
      const payload = people?.payload as unknown as WebhookPayload;
      expect(payload.meeting.participants).toEqual(['Ada King']);
      expect(payload.occurredAt).toBe(clock.toISOString());
      expect(people?.nextAttemptAt.getTime()).toBe(clock.getTime() + WEBHOOK_DEBOUNCE_MS);

      const live = await meeting({ status: 'recording' });
      expect(await emitWebhookEvent(test.db, 'meeting.updated', live.id)).toBe(0);
    });
  });

  describe('delivering', () => {
    it('signs every attempt and sends the documented headers', async () => {
      const e = await endpoint();
      const m = await meeting();
      await emitWebhookEvent(test.db, 'meeting.transcribed', m.id, { now: clock });
      expect(await dispatcher().drain()).toBe(1);
      const [request] = sent;
      const [row] = await deliveries();
      expect(request?.headers).toMatchObject({
        'content-type': 'application/json',
        'user-agent': 'OpenMinutes-Webhooks/9.9.9',
        'x-openminutes-event': 'meeting.transcribed',
        'x-openminutes-delivery': row?.id,
        'x-openminutes-event-id': row?.eventId,
      });
      expect(request?.body).toBe(JSON.stringify(row?.payload));
      expect(
        verifyWebhookSignature(
          SIGNING,
          request?.body ?? '',
          request?.headers['x-openminutes-signature'] ?? '',
          { now: Math.floor(clock.getTime() / 1000) },
        ),
      ).toBe(true);
      expect(row).toMatchObject({ status: 'succeeded', attempts: 1, lastStatusCode: 200 });
      const [after] = await test.db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, e.id));
      expect(after?.lastSuccessAt).toEqual(clock);
    });

    it('retries with backoff, six attempts, then gives up as dead', async () => {
      await endpoint();
      const m = await meeting();
      answer = () => Promise.resolve({ status: 503, body: 'down' });
      await emitWebhookEvent(test.db, 'meeting.transcribed', m.id, { now: clock });
      const run = dispatcher();
      const waits = [30_000, 2 * MINUTE, 10 * MINUTE, 60 * MINUTE, 360 * MINUTE];
      for (const [index, wait] of waits.entries()) {
        await run.drain();
        const [row] = await deliveries();
        expect(row).toMatchObject({
          status: 'failed',
          attempts: index + 1,
          lastStatusCode: 503,
          lastError: 'HTTP 503: down',
        });
        expect(row?.nextAttemptAt.getTime()).toBe(clock.getTime() + wait);
        advance(wait - 1000);
        expect(await run.drain()).toBe(0);
        advance(1000);
      }
      await run.drain();
      const [dead] = await deliveries();
      expect(dead).toMatchObject({ status: 'dead', attempts: WEBHOOK_MAX_ATTEMPTS });
      expect(dead?.completedAt).toEqual(clock);
      advance(24 * 60 * MINUTE);
      expect(await run.drain()).toBe(0);
      expect(sent).toHaveLength(6);
      expect(new Set(sent.map((r) => r.headers['x-openminutes-signature'])).size).toBe(6);
    });

    it('counts a network error as a failed attempt', async () => {
      await endpoint();
      answer = () => Promise.reject(new Error('connect ECONNREFUSED'));
      await emitWebhookEvent(test.db, 'meeting.transcribed', (await meeting()).id, { now: clock });
      await dispatcher().drain();
      expect((await deliveries())[0]).toMatchObject({
        status: 'failed',
        lastStatusCode: null,
        lastError: 'connect ECONNREFUSED',
      });
    });

    it('takes over rows a crashed worker left delivering', async () => {
      await endpoint();
      await emitWebhookEvent(test.db, 'meeting.transcribed', (await meeting()).id, { now: clock });
      // A worker claimed the row and died before it recorded anything.
      await test.db.update(webhookDeliveries).set({ status: 'delivering', lastAttemptAt: clock });
      expect(await dispatcher().drain()).toBe(0);
      advance(WEBHOOK_STUCK_MS + 1000);
      expect(await dispatcher().drain()).toBe(1);
      expect((await deliveries())[0]).toMatchObject({ status: 'succeeded', attempts: 1 });
    });

    it('claims each row once when several dispatchers run', async () => {
      await endpoint();
      for (let i = 0; i < 15; i += 1) {
        await emitWebhookEvent(test.db, 'meeting.transcribed', (await meeting()).id, {
          now: clock,
        });
      }
      await Promise.all([dispatcher().drain(), dispatcher().drain(), dispatcher().drain()]);
      expect(sent).toHaveLength(15);
      expect((await deliveries()).every((row) => row.status === 'succeeded')).toBe(true);
    });

    it('connects to the address it checked, so a rebinding host cannot switch', async () => {
      await endpoint();
      const answers = [PUBLIC_IP, '169.254.169.254'];
      let lookups = 0;
      resolve = () => {
        const address = answers[Math.min(lookups, 1)] ?? PUBLIC_IP;
        lookups += 1;
        return Promise.resolve([{ address, family: 4 }]);
      };
      await emitWebhookEvent(test.db, 'meeting.transcribed', (await meeting()).id, { now: clock });
      await dispatcher().drain();
      expect(lookups).toBe(1);
      expect(sent[0]?.address).toEqual({ address: PUBLIC_IP, family: 4 });

      // The next attempt resolves again and refuses the metadata address without sending.
      await emitWebhookEvent(test.db, 'meeting.transcribed', (await meeting()).id, { now: clock });
      await dispatcher().drain();
      expect(sent).toHaveLength(1);
      const failed = (await deliveries()).find((row) => row.status === 'failed');
      expect(failed?.lastError).toContain('169.254.169.254');
    });

    it('refuses private hosts and http unless the endpoint allows them', async () => {
      await endpoint({ url: 'http://receiver.lan/hook' });
      resolve = () => Promise.resolve([{ address: '192.168.1.10', family: 4 }]);
      await emitWebhookEvent(test.db, 'meeting.transcribed', (await meeting()).id, { now: clock });
      await dispatcher().drain();
      expect(sent).toHaveLength(0);
      await test.db.update(webhookEndpoints).set({ allowPrivate: true });
      advance(MINUTE);
      await dispatcher().drain();
      expect(sent[0]?.address.address).toBe('192.168.1.10');
    });

    it('switches an endpoint off after ten dead deliveries in a row', async () => {
      const e = await endpoint();
      answer = () => Promise.resolve({ status: 500, body: '' });
      await test.db.update(webhookEndpoints).set({ consecutiveFailures: 9 });
      await emitWebhookEvent(test.db, 'meeting.transcribed', (await meeting()).id, { now: clock });
      await test.db.update(webhookDeliveries).set({ attempts: WEBHOOK_MAX_ATTEMPTS - 1 });
      await dispatcher().drain();
      const [after] = await test.db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, e.id));
      expect(after).toMatchObject({ active: false, consecutiveFailures: 10 });
      expect(after?.disabledReason).toContain('10');
      // Events are no longer queued for it, but a test ping still goes out.
      expect(await emitWebhookEvent(test.db, 'meeting.transcribed', (await meeting()).id)).toBe(0);
      await queueWebhookTest(test.db, e.id, clock);
      answer = () => Promise.resolve({ status: 200, body: '' });
      await dispatcher().drain();
      expect(sent.at(-1)?.headers['x-openminutes-event']).toBe('webhook.test');
    });

    it('tries a test ping once and keeps it out of the health', async () => {
      const e = await endpoint();
      answer = () => Promise.resolve({ status: 404, body: '' });
      const ping = await queueWebhookTest(test.db, e.id, clock);
      expect(ping.payload).toMatchObject({
        event: 'webhook.test',
        meeting: { id: '00000000-0000-4000-8000-000000000000' },
      });
      await dispatcher().drain();
      expect((await deliveries())[0]).toMatchObject({ status: 'dead', attempts: 1, kind: 'test' });
      const health = await webhookHealth(test.db, [e], clock);
      expect(health.get(e.id)?.state).toBe('idle');
    });

    it('replays a delivery as a new row with the same event id and a fresh signature', async () => {
      await endpoint();
      await emitWebhookEvent(test.db, 'meeting.transcribed', (await meeting()).id, { now: clock });
      await dispatcher().drain();
      const [first] = await deliveries();
      if (!first) throw new Error('no delivery');
      advance(MINUTE);
      const replay = await replayWebhookDelivery(test.db, first, clock);
      await dispatcher().drain();
      expect(replay).toMatchObject({ kind: 'replay', eventId: first.eventId });
      expect(await deliveries()).toHaveLength(2);
      expect(sent[1]?.body).toBe(sent[0]?.body);
      expect(sent[1]?.headers['x-openminutes-signature']).not.toBe(
        sent[0]?.headers['x-openminutes-signature'],
      );
    });

    it('nudge and stop run the queue in the background', async () => {
      await endpoint();
      await emitWebhookEvent(test.db, 'meeting.transcribed', (await meeting()).id, { now: clock });
      const run = dispatcher();
      run.nudge();
      run.nudge();
      await run.stop();
      expect(sent).toHaveLength(1);
    });
  });

  describe('health and retention', () => {
    it('reports idle, healthy, degraded, failing and disabled', async () => {
      const idle = await endpoint();
      const healthy = await endpoint();
      const degraded = await endpoint();
      const failing = await endpoint();
      const off = await endpoint({ active: false, disabledReason: 'Switched off' });
      const m = await meeting();
      const row = (endpointId: string, status: 'succeeded' | 'failed' | 'dead', ago: number) => ({
        endpointId,
        event: 'meeting.transcribed',
        eventId: m.id,
        meetingId: m.id,
        payload: {},
        status,
        attempts: 1,
        lastAttemptAt: new Date(clock.getTime() - ago),
        completedAt: status === 'failed' ? null : new Date(clock.getTime() - ago),
        createdAt: new Date(clock.getTime() - ago),
      });
      await test.db
        .insert(webhookDeliveries)
        .values([
          row(healthy.id, 'dead', 3 * MINUTE),
          row(healthy.id, 'succeeded', MINUTE),
          row(degraded.id, 'succeeded', 3 * MINUTE),
          row(degraded.id, 'failed', MINUTE),
          row(failing.id, 'dead', 3 * MINUTE),
          row(failing.id, 'dead', 2 * MINUTE),
          row(failing.id, 'dead', MINUTE),
          row(off.id, 'succeeded', 48 * 60 * MINUTE),
        ]);
      const health = await webhookHealth(test.db, [idle, healthy, degraded, failing, off], clock);
      expect([idle, healthy, degraded, failing, off].map((e) => health.get(e.id)?.state)).toEqual([
        'idle',
        'healthy',
        'degraded',
        'failing',
        'disabled',
      ]);
      expect(health.get(healthy.id)).toMatchObject({ succeeded24h: 1, failed24h: 1, pending: 0 });
      expect(health.get(degraded.id)).toMatchObject({ pending: 1 });
      expect(health.get(off.id)).toMatchObject({
        disabledReason: 'Switched off',
        succeeded24h: 0,
      });
    });

    it('removes finished deliveries after 30 days', async () => {
      const e = await endpoint();
      const m = await meeting();
      const old = new Date(clock.getTime() - 31 * 24 * 60 * MINUTE);
      const base = {
        endpointId: e.id,
        event: 'meeting.transcribed',
        eventId: m.id,
        payload: {},
      };
      await test.db.insert(webhookDeliveries).values([
        { ...base, status: 'succeeded', createdAt: old },
        { ...base, status: 'dead', createdAt: old },
        { ...base, status: 'succeeded', createdAt: clock },
      ]);
      expect(await deleteOldWebhookDeliveries(test.db, clock)).toBe(2);
      expect(await deliveries()).toHaveLength(1);
    });
  });
});
