import { createProviders } from '@openminutes/calendar';
import { loadAutoSummary, LocalStorage, SettingsStore } from '@openminutes/core';
import { meetings, shareEmails, summaries } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { createBuiltinExporters } from '@openminutes/minutes';
import type { Hono } from 'hono';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { AccessVerifier } from '../auth/access.js';
import { makeKey, signToken, startFakeJwks, type FakeJwks } from '../auth/access-fixtures.js';
import type { EmailSettingsDto } from '../dto.js';
import { runEmailOrganizer } from './auto-organizer.js';

const secret = 'a-long-enough-test-secret';

describe('automatic mail of the summary to the organizer', () => {
  const key = makeKey('key-1');
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let jwks: FakeJwks;
  let app: Hono;
  let settings: SettingsStore;
  let outbox: Record<string, unknown>[] = [];
  const fetchStub = (_url: string, init?: RequestInit) => {
    outbox.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as never);
    return Promise.resolve(
      new Response('{"id":"mail-1"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  const deps = () => ({ db: test.db, settings, mailDeps: { fetch: fetchStub } });

  const put = (path: string, body: unknown) =>
    app.request(path, {
      method: 'PUT',
      headers: {
        'cf-access-jwt-assertion': signToken(key),
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  const save = (autoSummary?: 'off' | 'organizer' | 'everyone') =>
    put('/api/settings/email', {
      fromName: 'Minutes',
      fromAddress: 'minutes@example.com',
      ownerAddress: 'owner@example.com',
      subject: '',
      body: '',
      ...(autoSummary !== undefined && { autoSummary }),
    });

  async function meeting(invitees: { email: string; organizer?: boolean; declined?: boolean }[]) {
    const [row] = await test.db
      .insert(meetings)
      .values({
        title: 'Roadmap review',
        platform: 'meet',
        joinUrl: `https://meet.google.com/${crypto.randomUUID()}`,
        status: 'transcribed',
        startedAt: new Date('2026-03-12T09:30:00Z'),
        invitees: invitees.map((invitee) => ({ name: null, declined: false, ...invitee })),
      })
      .returning();
    if (!row) throw new Error('no meeting');
    return row.id;
  }
  const summarize = async (meetingId: string, content: string) => {
    const [row] = await test.db
      .insert(summaries)
      .values({ meetingId, provider: 'test', model: 'test', status: 'done', origin: 'ai', content })
      .returning();
    return row?.id ?? '';
  };

  beforeAll(async () => {
    test = await createTestDatabase();
    jwks = await startFakeJwks([key]);
    settings = new SettingsStore(test.db, secret);
    app = createApp({
      db: test.db,
      settings,
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-auto-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      access: new AccessVerifier(jwks.config),
      exporters: createBuiltinExporters(),
      providerDeps: { fetch: fetchStub },
    });
    await put('/api/settings/email/provider', {
      provider: 'emailit',
      config: { apiKey: 'key-123', domain: 'example.com' },
    });
  });
  afterAll(async () => {
    await jwks.close();
    await test.close();
  });
  beforeEach(async () => {
    outbox = [];
    await test.db.delete(shareEmails);
    await save('off');
  });

  it('is off by default and the setting round trips', async () => {
    const id = await meeting([{ email: 'boss@example.com', organizer: true }]);
    await summarize(id, '## Decisions\n\n- Ship it');
    expect(await runEmailOrganizer(deps(), id)).toBe('off');
    expect(outbox).toHaveLength(0);
    const on = await save('organizer');
    expect(((await on.json()) as EmailSettingsDto).autoSummary).toBe('organizer');
    const kept = await save();
    expect(((await kept.json()) as EmailSettingsDto).autoSummary).toBe('organizer');
    const all = await save('everyone');
    expect(((await all.json()) as EmailSettingsDto).autoSummary).toBe('everyone');
    const off = await save('off');
    expect(((await off.json()) as EmailSettingsDto).autoSummary).toBe('off');
  });

  it('reads the old on/off setting as organizer only, and a new choice replaces it', async () => {
    await settings.set('email.auto_organizer', 'true');
    const old = await app.request('/api/settings/email', {
      headers: { 'cf-access-jwt-assertion': signToken(key) },
    });
    expect(((await old.json()) as EmailSettingsDto).autoSummary).toBe('organizer');
    await save('everyone');
    expect(await settings.get('email.auto_organizer')).toBeUndefined();
    await save('off');
    expect(await loadAutoSummary(settings)).toBe('off');
  });

  it('mails everyone who has not declined, one mail each, and each person once', async () => {
    await save('everyone');
    const id = await meeting([
      { email: 'boss@example.com', organizer: true },
      { email: 'anna@example.com' },
      { email: 'gone@example.com', declined: true },
    ]);
    await summarize(id, 'Notes');
    expect(await runEmailOrganizer(deps(), id)).toBe('sent');
    expect(outbox.map((mail) => mail['to']).sort()).toEqual([
      ['Anna@example.com'.toLowerCase()],
      ['boss@example.com'],
    ]);
    expect(await runEmailOrganizer(deps(), id)).toBe('already-sent');
    expect(outbox).toHaveLength(2);
    // The auto mails are not shares: Share with attendees still lists nobody as received.
    const [log] = await test.db.select().from(shareEmails);
    expect(log?.items[0]).toMatch(/^auto-organizer:/);
  });

  it('retries only the people who did not get the mail', async () => {
    await save('everyone');
    const id = await meeting([{ email: 'a@example.com' }, { email: 'b@example.com' }]);
    await summarize(id, 'Notes');
    let calls = 0;
    const flaky = (url: string, init?: RequestInit) => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(new Response('boom', { status: 500 }))
        : fetchStub(url, init);
    };
    await expect(
      runEmailOrganizer({ ...deps(), mailDeps: { fetch: flaky } }, id),
    ).rejects.toThrow();
    expect(outbox).toHaveLength(1);
    expect(await runEmailOrganizer(deps(), id)).toBe('sent');
    expect(outbox).toHaveLength(2);
    expect(new Set(outbox.map((mail) => String(mail['to'])))).toEqual(
      new Set(['a@example.com', 'b@example.com']),
    );
  });

  it('mails the whole summary to the organizer only', async () => {
    await save('organizer');
    const id = await meeting([
      { email: 'anna@example.com' },
      { email: 'Boss@Example.com', organizer: true },
    ]);
    await summarize(id, '## Decisions\n\n- Ship it <fast>');
    expect(await runEmailOrganizer(deps(), id)).toBe('sent');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.['to']).toEqual(['Boss@Example.com']);
    expect(outbox[0]?.['subject']).toContain('Roadmap review');
    expect(outbox[0]?.['text']).toContain('- Ship it <fast>');
    expect(outbox[0]?.['html']).toContain('Ship it &lt;fast&gt;');
    const [log] = await test.db.select().from(shareEmails);
    expect(log).toMatchObject({ recipient: 'boss@example.com', status: 'sent' });
  });

  it('never sends the same summary twice, but mails a new version', async () => {
    await save('organizer');
    const id = await meeting([{ email: 'boss@example.com', organizer: true }]);
    await summarize(id, 'First');
    expect(await runEmailOrganizer(deps(), id)).toBe('sent');
    expect(await runEmailOrganizer(deps(), id)).toBe('already-sent');
    expect(outbox).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await summarize(id, 'Second');
    expect(await runEmailOrganizer(deps(), id)).toBe('sent');
    expect(outbox).toHaveLength(2);
  });

  it('skips a meeting without a known organizer or a summary', async () => {
    await save('organizer');
    const nobody = await meeting([{ email: 'anna@example.com' }]);
    await summarize(nobody, 'Text');
    expect(await runEmailOrganizer(deps(), nobody)).toBe('no-organizer');
    const bare = await meeting([{ email: 'boss@example.com', organizer: true }]);
    expect(await runEmailOrganizer(deps(), bare)).toBe('no-summary');
    expect(outbox).toHaveLength(0);
  });
});
