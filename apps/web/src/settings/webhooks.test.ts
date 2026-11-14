import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { decryptSecret, LocalStorage, SettingsStore, type Resolver } from '@openminutes/core';
import {
  eq,
  meetings,
  participants,
  people,
  webhookDeliveries,
  webhookEndpoints,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { DeliveryDto, WebhookCreatedDto, WebhookDto, WebhookEventsDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const BASE = '/api/settings/webhooks';

describe('webhook settings', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let cookie: string;
  let dns: Record<string, string>;

  const resolver: Resolver = (host) => {
    const address = dns[host];
    return address
      ? Promise.resolve([{ address, family: 4 }])
      : Promise.reject(new Error('ENOTFOUND'));
  };
  const call = (method: string, path: string, body?: unknown, headers = {}) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: { ...json, cookie, ...headers },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const create = async (body: Record<string, unknown> = {}) => {
    const response = await call('POST', '', {
      name: 'Zapier',
      url: 'https://hooks.example.test/in',
      events: ['meeting.transcribed'],
      ...body,
    });
    expect(response.status).toBe(201);
    return (await response.json()) as WebhookCreatedDto;
  };
  const meeting = async (values: Partial<typeof meetings.$inferInsert> = {}) => {
    const [row] = await test.db
      .insert(meetings)
      .values({
        title: 'Weekly sync',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc',
        status: 'transcribed',
        ...values,
      })
      .returning();
    if (!row) throw new Error('no meeting');
    return row;
  };

  beforeAll(async () => {
    test = await createTestDatabase();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-webhooks-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      webhookResolver: resolver,
    });
    const setup = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  });
  afterAll(() => test.close());
  beforeEach(async () => {
    await test.db.delete(webhookEndpoints);
    await test.db.delete(meetings);
    dns = { 'hooks.example.test': '93.184.215.14', 'nas.lan': '192.168.1.20' };
  });

  it('lists the events', async () => {
    const response = await call('GET', '/events');
    const body = (await response.json()) as WebhookEventsDto;
    expect(body.events.map((event) => event.id)).toEqual([
      'meeting.transcribed',
      'meeting.summarized',
      'meeting.updated',
      'meeting.participants_updated',
      'meeting.deleted',
    ]);
    expect(body.events.every((event) => event.description.length > 0)).toBe(true);
  });

  it('shows the secret once and stores it encrypted', async () => {
    const created = await create({ filter: { titleContains: ['sync'], companies: [] } });
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(created.webhook).toMatchObject({
      name: 'Zapier',
      url: 'https://hooks.example.test/in',
      events: ['meeting.transcribed'],
      filter: { titleContains: ['sync'] },
      allowPrivate: false,
      active: true,
      secretPrefix: created.secret.slice(0, 10),
      health: { state: 'idle', pending: 0, succeeded24h: 0, failed24h: 0 },
    });
    const [row] = await test.db.select().from(webhookEndpoints);
    expect(JSON.stringify(row)).not.toContain(created.secret);
    expect(decryptSecret(row?.secretEncrypted ?? '', secret)).toBe(created.secret);
    const listed = (await (await call('GET', '')).json()) as WebhookDto[];
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    const one = (await (await call('GET', `/${created.webhook.id}`)).json()) as WebhookDto;
    expect(one.id).toBe(created.webhook.id);
  });

  it('validates the input', async () => {
    const bad = [
      { name: 'x', url: 'https://hooks.example.test/in', events: [] },
      { name: 'x', url: 'https://hooks.example.test/in', events: ['meeting.started'] },
      { name: '', url: 'https://hooks.example.test/in', events: ['meeting.deleted'] },
      { name: 'x', url: 'https://hooks.example.test/in', events: ['meeting.deleted'], extra: 1 },
      {
        name: 'x',
        url: 'https://hooks.example.test/in',
        events: ['meeting.deleted'],
        filter: { platforms: ['zoom'] },
      },
    ];
    for (const body of bad) expect((await call('POST', '', body)).status).toBe(400);
  });

  it('refuses private, metadata and plain http URLs unless private networks are allowed', async () => {
    const refused = async (url: string, allowPrivate = false) => {
      const response = await call('POST', '', {
        name: 'x',
        url,
        events: ['meeting.deleted'],
        allowPrivate,
      });
      return response.status === 400 ? ((await response.json()) as { error: string }).error : '';
    };
    expect(await refused('http://hooks.example.test/in')).toContain('https');
    expect(await refused('https://nas.lan/hook')).toContain('192.168.1.20');
    expect(await refused('https://127.0.0.1/hook')).toContain('private');
    expect(await refused('https://169.254.169.254/latest', true)).toContain('never allowed');
    expect(await refused('https://[::ffff:169.254.169.254]/', true)).toContain('never allowed');
    expect(await refused('https://user:pw@hooks.example.test/')).toContain('password');
    expect(await refused('https://unknown.test/')).toContain('could not be found');
    const lan = await create({ url: 'http://nas.lan:8080/hook', allowPrivate: true });
    expect(lan.webhook).toMatchObject({ allowPrivate: true, url: 'http://nas.lan:8080/hook' });
    // Taking the allowance away checks the URL again.
    expect((await call('PATCH', `/${lan.webhook.id}`, { allowPrivate: false })).status).toBe(400);
  });

  it('updates, reactivates and deletes', async () => {
    const { webhook } = await create();
    await test.db
      .update(webhookEndpoints)
      .set({ active: false, disabledReason: 'Switched off after 10', consecutiveFailures: 10 });
    const disabled = (await (await call('GET', `/${webhook.id}`)).json()) as WebhookDto;
    expect(disabled.health).toMatchObject({
      state: 'disabled',
      disabledReason: 'Switched off after 10',
    });
    const response = await call('PATCH', `/${webhook.id}`, {
      name: 'Renamed',
      events: ['meeting.deleted', 'meeting.deleted', 'meeting.summarized'],
      active: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: 'Renamed',
      events: ['meeting.deleted', 'meeting.summarized'],
      active: true,
      health: { state: 'idle', disabledReason: null },
    });
    const [row] = await test.db.select().from(webhookEndpoints);
    expect(row?.consecutiveFailures).toBe(0);
    expect((await call('PATCH', `/${webhook.id}`, { events: [] })).status).toBe(400);
    expect((await call('DELETE', `/${webhook.id}`)).status).toBe(200);
    expect((await call('GET', `/${webhook.id}`)).status).toBe(404);
    expect((await call('DELETE', '/not-a-uuid')).status).toBe(404);
  });

  it('rotates the secret', async () => {
    const created = await create();
    const response = await call('POST', `/${created.webhook.id}/rotate-secret`);
    const { secret: next } = (await response.json()) as { secret: string };
    expect(next).toMatch(/^whsec_/);
    expect(next).not.toBe(created.secret);
    const [row] = await test.db.select().from(webhookEndpoints);
    expect(decryptSecret(row?.secretEncrypted ?? '', secret)).toBe(next);
    expect(row?.secretPrefix).toBe(next.slice(0, 10));
  });

  it('queues a test ping and a test event for a real meeting', async () => {
    const { webhook } = await create({ filter: { titleContains: ['never matches'] } });
    const ping = await call('POST', `/${webhook.id}/test`);
    expect(ping.status).toBe(202);
    const { delivery } = (await ping.json()) as { delivery: DeliveryDto };
    expect(delivery).toMatchObject({
      event: 'webhook.test',
      kind: 'test',
      status: 'pending',
      attempts: 0,
      payload: { meeting: { title: 'Test event from OpenMinutes' } },
    });

    expect(
      (await call('POST', `/${webhook.id}/test-event`, { event: 'meeting.summarized' })).status,
    ).toBe(404);
    await meeting({ title: 'Older', createdAt: new Date('2026-01-01T00:00:00Z') });
    const latest = await meeting({ title: 'Latest' });
    // The filter is ignored and the latest transcribed meeting is used.
    const real = await call('POST', `/${webhook.id}/test-event`, { event: 'meeting.summarized' });
    expect(real.status).toBe(202);
    expect(((await real.json()) as { delivery: DeliveryDto }).delivery).toMatchObject({
      event: 'meeting.summarized',
      kind: 'test',
      meetingId: latest.id,
      payload: { event: 'meeting.summarized', meeting: { id: latest.id, title: 'Latest' } },
    });
    const missing = await call('POST', `/${webhook.id}/test-event`, {
      event: 'meeting.deleted',
      meetingId: '00000000-0000-4000-8000-000000000001',
    });
    expect(missing.status).toBe(404);
  });

  it('lists deliveries newest first with status and paging, and replays one', async () => {
    const { webhook } = await create();
    const m = await meeting();
    const base = {
      endpointId: webhook.id,
      event: 'meeting.transcribed',
      eventId: m.id,
      meetingId: m.id,
      payload: { id: m.id },
    };
    await test.db.insert(webhookDeliveries).values([
      { ...base, status: 'dead', attempts: 6, createdAt: new Date('2026-11-01T10:00:00Z') },
      { ...base, status: 'succeeded', attempts: 1, createdAt: new Date('2026-11-02T10:00:00Z') },
      { ...base, status: 'failed', attempts: 2, createdAt: new Date('2026-11-03T10:00:00Z') },
    ]);
    const all = (await (await call('GET', `/${webhook.id}/deliveries`)).json()) as DeliveryDto[];
    expect(all.map((d) => d.status)).toEqual(['failed', 'succeeded', 'dead']);
    expect(all[0]).toMatchObject({ maxAttempts: 6, kind: 'event' });
    expect(all[2]?.nextAttemptAt).toBeNull();
    const dead = (await (
      await call('GET', `/${webhook.id}/deliveries?status=dead`)
    ).json()) as DeliveryDto[];
    expect(dead).toHaveLength(1);
    const page = (await (
      await call('GET', `/${webhook.id}/deliveries?limit=1&before=2026-11-03T00:00:00.000Z`)
    ).json()) as DeliveryDto[];
    expect(page.map((d) => d.status)).toEqual(['succeeded']);
    expect((await call('GET', `/${webhook.id}/deliveries?status=lost`)).status).toBe(400);

    const replay = await call('POST', `/${webhook.id}/deliveries/${dead[0]?.id ?? ''}/replay`);
    expect(replay.status).toBe(202);
    expect(((await replay.json()) as { delivery: DeliveryDto }).delivery).toMatchObject({
      kind: 'replay',
      status: 'pending',
      eventId: m.id,
      payload: { id: m.id },
    });
    expect(await test.db.select().from(webhookDeliveries)).toHaveLength(4);
    const other = await create();
    expect(
      (await call('POST', `/${other.webhook.id}/deliveries/${dead[0]?.id ?? ''}/replay`)).status,
    ).toBe(404);

    const listed = (await (await call('GET', `/${webhook.id}`)).json()) as WebhookDto;
    expect(listed.health).toMatchObject({ state: 'degraded', pending: 2 });
  });

  it('fires meeting.updated and meeting.participants_updated after edits of a transcribed meeting', async () => {
    await create({ events: ['meeting.updated', 'meeting.participants_updated'] });
    const m = await meeting();
    const [ann] = await test.db
      .insert(participants)
      .values({ meetingId: m.id, displayName: 'Speaker 1' })
      .returning();
    const title = await app.request(`/api/meetings/${m.id}`, {
      method: 'PATCH',
      headers: { ...json, cookie },
      body: JSON.stringify({ title: 'Renamed sync' }),
    });
    expect(title.status).toBe(200);
    const rename = await app.request(`/api/meetings/${m.id}/participants/${ann?.id ?? ''}`, {
      method: 'PUT',
      headers: { ...json, cookie },
      body: JSON.stringify({ name: 'Ann' }),
    });
    expect(rename.status).toBe(200);
    const rows = await test.db.select().from(webhookDeliveries);
    expect(rows.map((row) => row.event).sort()).toEqual([
      'meeting.participants_updated',
      'meeting.updated',
    ]);
    const people_ = rows.find((row) => row.event === 'meeting.participants_updated');
    expect(people_?.payload).toMatchObject({
      meeting: { title: 'Renamed sync', participants: ['Ann'] },
    });
  });

  it('fires meeting.participants_updated for the meetings of a renamed person', async () => {
    await create({ events: ['meeting.participants_updated'] });
    const m = await meeting();
    const [person] = await test.db.insert(people).values({ name: 'Bea' }).returning();
    await test.db
      .insert(participants)
      .values({ meetingId: m.id, displayName: 'Bea', personId: person?.id ?? null });
    const response = await app.request(`/api/people/${person?.id ?? ''}`, {
      method: 'PATCH',
      headers: { ...json, cookie },
      body: JSON.stringify({ name: 'Bea Smith' }),
    });
    expect(response.status).toBe(200);
    // The emit runs after the response, so wait for it.
    await vi.waitFor(async () => {
      const rows = await test.db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.meetingId, m.id));
      expect(rows.map((row) => row.event)).toEqual(['meeting.participants_updated']);
    });
  });

  it('fires meeting.deleted when a meeting is binned', async () => {
    await create({ events: ['meeting.deleted'] });
    const m = await meeting();
    const response = await app.request('/api/meetings/bulk', {
      method: 'POST',
      headers: { ...json, cookie },
      body: JSON.stringify({ action: 'delete', ids: [m.id] }),
    });
    expect(response.status).toBeLessThan(300);
    const rows = await test.db.select().from(webhookDeliveries);
    expect(rows.map((row) => [row.event, row.meetingId])).toEqual([['meeting.deleted', m.id]]);
  });
});
