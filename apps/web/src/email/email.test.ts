import { createProviders } from '@openminutes/calendar';
import { encryptSecret, LocalStorage, SettingsStore } from '@openminutes/core';
import { calendarAccounts, meetings, participants, shareEmails, shareLinks } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { createBuiltinExporters, type Exporter } from '@openminutes/minutes';
import type { Hono } from 'hono';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { shareLinkExporter } from '../minutes/exporters.js';
import { AccessVerifier } from '../auth/access.js';
import { makeKey, signToken, startFakeJwks, type FakeJwks } from '../auth/access-fixtures.js';
import type {
  EmailSettingsDto,
  MeetingExportDto,
  ProviderTestDto,
  ShareEmailInput,
  ShareEmailOptionsDto,
  ShareEmailPreviewDto,
  ShareEmailResultDto,
} from '../dto.js';

const secret = 'a-long-enough-test-secret';
const owner = 'owner@example.com';

describe('sharing minutes by email', () => {
  const key = makeKey('key-1');
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let jwks: FakeJwks;
  let app: Hono;
  let meetingId = '';
  let outbox: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const grant = vi.fn((input: { emails: string[] }) =>
    Promise.resolve({ granted: input.emails, failed: [] }),
  );

  let failNext = false;
  const fetchStub = (url: string, init?: RequestInit) => {
    if (failNext) {
      failNext = false;
      return Promise.resolve(new Response('{"error":"Unauthorized domain"}', { status: 403 }));
    }
    outbox.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ id: `mail-${String(outbox.length)}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  beforeAll(async () => {
    test = await createTestDatabase();
    jwks = await startFakeJwks([key]);
    const doc: Exporter = {
      id: 'doc',
      label: 'Doc',
      description: '',
      destination: true,
      shareLabel: 'Doc',
      export: () =>
        Promise.resolve({
          kind: 'link',
          url: 'https://docs.example/1',
          label: 'Open the Doc',
          ref: 'doc-1',
        }),
      grantAccess: grant,
    };
    const plain: Exporter = { ...doc, id: 'plain' };
    delete (plain as { grantAccess?: unknown }).grantAccess;
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-email-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      access: new AccessVerifier(jwks.config),
      publicUrl: 'https://minutes.example/',
      exporters: createBuiltinExporters()
        .register(shareLinkExporter(test.db, 'https://minutes.example'))
        .register(doc)
        .register(plain),
      providerDeps: { fetch: fetchStub },
    });
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Roadmap review',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'transcribed',
        startedAt: new Date('2026-03-12T09:30:00Z'),
        endedAt: new Date('2026-03-12T10:00:00Z'),
        invitees: [
          { email: 'anna@example.com', name: 'Anna de Vries', declined: false },
          { email: 'daan@example.com', name: 'Daan Jansen', declined: false },
          { email: 'eva@example.com', name: 'Eva Bakker', declined: true },
        ],
      })
      .returning();
    if (!meeting) throw new Error('no meeting');
    meetingId = meeting.id;
    await test.db.insert(participants).values({ meetingId, displayName: 'Anna de Vries' });
  });
  afterAll(async () => {
    await jwks.close();
    await test.close();
  });
  beforeEach(() => {
    outbox = [];
    grant.mockClear();
  });

  // The response type is the test's claim about the API, so it appears once by design.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: {
        'cf-access-jwt-assertion': signToken(key),
        origin: 'http://localhost',
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as T };
  };

  const share = (id = meetingId) => `/api/meetings/${id}/share-email`;
  const baseInput = (overrides: Partial<ShareEmailInput> = {}): ShareEmailInput => ({
    recipients: ['anna@example.com', 'daan@example.com'],
    extra: [],
    format: 'share-link',
    subject: 'Minutes: {{title}}',
    body: 'Hi, the minutes of {{title}} on {{date}}.\n\n{{link}}',
    force: false,
    ...overrides,
  });

  it('is not configured until a provider and sender are saved', async () => {
    const options = await call<ShareEmailOptionsDto>('GET', share());
    expect(options.data.configured).toBe(false);
    const sent = await call('POST', share(), baseInput());
    expect(sent.status).toBe(400);
    expect(outbox).toHaveLength(0);
  });

  it('refuses a test mail without an owner address and never mails anyone else', async () => {
    await call('PUT', '/api/settings/email/provider', {
      provider: 'emailit',
      config: { apiKey: 'key-123', domain: 'example.com' },
    });
    await call('PUT', '/api/settings/email', {
      fromName: 'Minutes',
      fromAddress: 'minutes@example.com',
      ownerAddress: '',
      subject: '',
      body: '',
    });
    const refused = await call<ProviderTestDto>('POST', '/api/settings/email/send-test');
    expect(refused.data.ok).toBe(false);
    expect(outbox).toHaveLength(0);

    const saved = await call<EmailSettingsDto>('PUT', '/api/settings/email', {
      fromName: 'Minutes',
      fromAddress: 'minutes@example.com',
      ownerAddress: owner,
      subject: '',
      body: '',
    });
    expect(saved.data.providerReady).toBe(true);
    const sent = await call<ProviderTestDto>('POST', '/api/settings/email/send-test');
    expect(sent.data).toEqual({ ok: true, detail: `sent to ${owner}` });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.body['to']).toEqual([owner]);
    expect(outbox[0]?.headers.get('authorization')).toBe('Bearer key-123');
  });

  const restoreSender = async () => {
    await call('PUT', '/api/settings/email/provider', {
      provider: 'emailit',
      config: { apiKey: 'key-123', domain: 'example.com' },
    });
    await call('PUT', '/api/settings/email', {
      fromName: 'Minutes',
      fromAddress: 'minutes@example.com',
      ownerAddress: owner,
      subject: '',
      body: '',
    });
  };

  it('keeps the from address on the Emailit sending domain', async () => {
    const provider = await call<{ providers: { id: string; fields: { name: string }[] }[] }>(
      'GET',
      '/api/settings/email/provider',
    );
    const emailit = provider.data.providers.find((p) => p.id === 'emailit');
    expect(emailit?.fields.map((f) => f.name)).toEqual(['apiKey', 'domain']);

    await call('PUT', '/api/settings/email/provider', {
      provider: 'emailit',
      config: { apiKey: 'key-123', domain: 'Mail.Example.com' },
    });
    const sender = { fromName: 'Minutes', ownerAddress: owner, subject: '', body: '' };

    const wrong = await call('PUT', '/api/settings/email', {
      ...sender,
      fromAddress: 'minutes@other.com',
    });
    expect(wrong.status).toBe(400);

    const short = await call<EmailSettingsDto>('PUT', '/api/settings/email', {
      ...sender,
      fromAddress: 'minutes',
    });
    expect(short.data.fromAddress).toBe('minutes@mail.example.com');
    expect(short.data.sendingDomain).toBe('mail.example.com');

    const sent = await call<ProviderTestDto>('POST', '/api/settings/email/send-test');
    expect(sent.data.ok).toBe(true);
    expect(outbox[0]?.body['from']).toBe('Minutes <minutes@mail.example.com>');
    await restoreSender();
  });

  it('refuses to send when the saved from address left the sending domain', async () => {
    await call('PUT', '/api/settings/email/provider', {
      provider: 'emailit',
      config: { apiKey: 'key-123', domain: 'example.com' },
    });
    await call('PUT', '/api/settings/email', {
      fromName: 'Minutes',
      fromAddress: 'minutes@example.com',
      ownerAddress: owner,
      subject: '',
      body: '',
    });
    await call('PUT', '/api/settings/email/provider', {
      provider: 'emailit',
      config: { apiKey: 'key-123', domain: 'else.com' },
    });
    const refused = await call<ProviderTestDto>('POST', '/api/settings/email/send-test');
    expect(refused.data.ok).toBe(false);
    expect(refused.data.error).toContain('else.com');
    expect(outbox).toHaveLength(0);
    await restoreSender();
  });

  it('lists attendees with known emails and preselects the ones who did not decline', async () => {
    const { data } = await call<ShareEmailOptionsDto>('GET', share());
    expect(data.configured).toBe(true);
    expect(data.recipients.map((r) => [r.email, r.attended, r.declined])).toEqual([
      ['anna@example.com', true, false],
      ['daan@example.com', false, false],
      ['eva@example.com', false, true],
    ]);
  });

  it('previews without sending or creating a share link', async () => {
    const { status, data } = await call<ShareEmailPreviewDto>(
      'POST',
      `${share()}/preview`,
      baseInput({ extra: ['Guest@Example.com'] }),
    );
    expect(status).toBe(200);
    expect(data.willSend).toEqual(['anna@example.com', 'daan@example.com', 'Guest@Example.com']);
    expect(data.subject).toBe('Minutes: Roadmap review');
    expect(data.html).toContain('Powered by');
    expect(outbox).toHaveLength(0);
    expect(await test.db.select().from(shareLinks)).toHaveLength(0);
  });

  it('needs at least one person and a format that can be shared', async () => {
    const nobody = await call('POST', share(), baseInput({ recipients: [] }));
    const nothing = await call('POST', share(), baseInput({ format: 'markdown' }));
    expect([nobody.status, nothing.status]).toEqual([400, 400]);
    expect(outbox).toHaveLength(0);
  });

  it('offers the enabled formats and whether they exist yet', async () => {
    const options = await call<ShareEmailOptionsDto>('GET', share());
    expect(options.data.formats.map((f) => [f.id, f.label, f.url])).toEqual([
      ['share-link', 'Shareable link', null],
    ]);
    expect(options.data.placeholders).toEqual(['title', 'date', 'link']);
  });

  it('sends one separate mail per person, creates the link and logs it', async () => {
    const { status, data } = await call<ShareEmailResultDto>('POST', share(), {
      ...baseInput(),
    });
    expect(status).toBe(200);
    expect(data.sent).toEqual(['anna@example.com', 'daan@example.com']);
    expect(outbox.map((mail) => mail.body['to'])).toEqual([
      ['anna@example.com'],
      ['daan@example.com'],
    ]);
    const [links, log] = await Promise.all([
      test.db.select().from(shareLinks),
      test.db.select().from(shareEmails),
    ]);
    expect(links).toHaveLength(1);
    const url = `https://minutes.example/s/${links[0]?.token ?? ''}`;
    expect(String(outbox[0]?.body['text'])).toContain(url);
    expect(String(outbox[0]?.body['html'])).toContain('Powered by');
    expect(log.map((row) => [row.recipient, row.status, row.items])).toEqual([
      ['anna@example.com', 'sent', ['share-link']],
      ['daan@example.com', 'sent', ['share-link']],
    ]);
  });

  it('is idempotent per recipient unless forced', async () => {
    const options = await call<ShareEmailOptionsDto>('GET', share());
    expect(options.data.recipients.filter((r) => r.sentAt).map((r) => r.email)).toEqual([
      'anna@example.com',
      'daan@example.com',
    ]);

    const again = await call<ShareEmailResultDto>('POST', share(), {
      ...baseInput({ recipients: ['Anna@example.com'] }),
    });
    expect(again.data.sent).toEqual([]);
    expect(again.data.skipped).toEqual(['Anna@example.com']);
    expect(outbox).toHaveLength(0);

    const mixed = await call<ShareEmailResultDto>('POST', share(), {
      ...baseInput({ extra: ['new@example.com'] }),
    });
    expect(mixed.data.sent).toEqual(['new@example.com']);
    expect(mixed.data.skipped).toEqual(['anna@example.com', 'daan@example.com']);

    const forced = await call<ShareEmailResultDto>('POST', share(), {
      ...baseInput({ force: true }),
    });
    expect(forced.data.sent).toHaveLength(2);
  });

  it('records a failure and lets the same person be retried', async () => {
    failNext = true;
    const input = baseInput({ recipients: ['retry@example.com'] });
    const failed = await call<ShareEmailResultDto>('POST', share(), input);
    expect(failed.data.failed[0]).toMatchObject({ email: 'retry@example.com' });
    expect(failed.data.sent).toEqual([]);

    const retried = await call<ShareEmailResultDto>('POST', share(), input);
    expect(retried.data.sent).toEqual(['retry@example.com']);
    const log = await test.db.select().from(shareEmails);
    expect(
      log.filter((row) => row.recipient === 'retry@example.com').map((row) => row.status),
    ).toEqual(['failed', 'sent']);
  });

  it('shares one document with one link, asks to grant access, or warns when it cannot', async () => {
    await call('PUT', '/api/settings/minutes', {
      template: 'classic',
      includeTranscript: false,
      includeChat: true,
      transcriptPlacement: 'tab',
      linksTab: false,
      destinations: ['share-link', 'doc', 'plain'],
    });
    const withGrant = await call<ShareEmailResultDto>('POST', share(), {
      ...baseInput({ recipients: ['grant@example.com'], format: 'doc' }),
    });
    expect(withGrant.data.warnings).toEqual([]);
    expect(grant).toHaveBeenCalledWith({
      meetingId,
      url: 'https://docs.example/1',
      emails: ['grant@example.com'],
    });
    const text = String(outbox[0]?.body['text']);
    expect(text).toContain('Read the minutes: https://docs.example/1');
    expect(text.match(/https:\/\/docs\.example/g)).toHaveLength(1);

    const without = await call<ShareEmailResultDto>(
      'POST',
      share(),
      baseInput({
        recipients: ['nogrant@example.com'],
        format: 'plain',
      }),
    );
    expect(without.data.warnings[0]).toMatch(/permissions were not changed/);
    expect(without.data.sent).toEqual(['nogrant@example.com']);
  });

  it('ignores the old {{document}} placeholder in saved message templates', async () => {
    const preview = await call<ShareEmailPreviewDto>(
      'POST',
      `${share()}/preview`,
      baseInput({ body: 'Hi\n\n{{link}}\n\n{{document}}' }),
    );
    expect(preview.data.text).not.toContain('{{document}}');
    expect(preview.data.text.match(/Read the minutes/g)).toHaveLength(1);
  });

  it('updates the same share link instead of making another one', async () => {
    const before = await test.db.select().from(shareLinks);
    await call('POST', share(), baseInput({ recipients: ['again@example.com'] }));
    expect(await test.db.select().from(shareLinks)).toHaveLength(before.length);
  });

  it('sends through the connected Gmail account once sending is allowed', async () => {
    const tokens = {
      accessToken: 'gmail-access',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
      scope: 'openid email https://www.googleapis.com/auth/gmail.send',
    };
    await test.db.insert(calendarAccounts).values({
      provider: 'google',
      accountEmail: 'bot@gmail.com',
      encryptedTokens: encryptSecret(JSON.stringify(tokens), secret),
    });
    await call('PUT', '/api/settings/email/provider', {
      provider: 'gmail',
      config: { account: 'bot@gmail.com' },
    });
    const settings = await call<EmailSettingsDto>('GET', '/api/settings/email');
    expect(settings.data.google.sendAccounts).toEqual(['bot@gmail.com']);

    const sent = await call<ShareEmailResultDto>('POST', share(), {
      ...baseInput({ recipients: ['gmail@example.com'] }),
    });
    expect(sent.data.sent).toEqual(['gmail@example.com']);
    expect(outbox[0]?.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(outbox[0]?.headers.get('authorization')).toBe('Bearer gmail-access');
  });

  it('reports a Gmail account that has not allowed sending', async () => {
    await call('PUT', '/api/settings/email/provider', {
      provider: 'gmail',
      config: { account: 'other@gmail.com' },
    });
    const sent = await call<ShareEmailResultDto>('POST', share(), {
      ...baseInput({ recipients: ['x@example.com'] }),
    });
    expect(sent.data.failed[0]?.error).toMatch(/has not allowed sending mail/);
    const log = await test.db.select().from(shareEmails);
    expect(log.find((row) => row.recipient === 'x@example.com')?.status).toBe('failed');
  });

  it('applies the parts chosen on the card to the shared link and its saved record', async () => {
    await call('PUT', '/api/settings/email/provider', {
      provider: 'emailit',
      config: { apiKey: 'key-123', domain: 'example.com' },
    });
    const sent = await call<ShareEmailResultDto>('POST', share(), {
      ...baseInput({ recipients: ['parts@example.com'] }),
      includeTranscript: true,
      includeChat: true,
      includeLinks: false,
    });
    expect(sent.data.sent).toEqual(['parts@example.com']);
    const [link] = await test.db.select().from(shareLinks);
    expect(link).toMatchObject({ includeTranscript: true, includeChat: true, includeLinks: false });
    const records = await call<MeetingExportDto[]>('GET', `/api/meetings/${meetingId}/exports`);
    expect(records.data.find((r) => r.exporterId === 'share-link')).toMatchObject({
      includeTranscript: true,
      includeChat: true,
    });
  });
});
