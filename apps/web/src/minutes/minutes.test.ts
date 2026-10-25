import { createHash } from 'node:crypto';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import {
  chatMessages,
  eq,
  meetingExports,
  meetings,
  participants,
  shareLinks,
  summaries,
  transcriptSegments,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { createBuiltinExporters, type Exporter } from '@openminutes/minutes';
import type { Hono } from 'hono';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { AccessVerifier } from '../auth/access.js';
import { makeKey, signToken, startFakeJwks, type FakeJwks } from '../auth/access-fixtures.js';
import type { ExporterDto, MeetingExportDto, MinutesSettingsDto } from '../dto.js';
import { shareLinkExporter } from './exporters.js';
import { createShareLink } from './share-routes.js';

const secret = 'a-long-enough-test-secret';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

describe('minutes, share links and exporters', () => {
  const key = makeKey('key-1');
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let jwks: FakeJwks;
  let app: Hono;
  let meetingId = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    jwks = await startFakeJwks([key]);
    const link: Exporter = {
      id: 'doc',
      label: 'Doc',
      description: 'Creates a doc',
      destination: true,
      export: ({ meetingId: id }) =>
        Promise.resolve({ kind: 'link', url: `https://docs.example/${id}`, label: 'Open doc' }),
    };
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-minutes-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      access: new AccessVerifier(jwks.config),
      publicUrl: 'https://minutes.example/',
      exporters: createBuiltinExporters()
        .register(shareLinkExporter(test.db, 'https://minutes.example'))
        .register(link),
    });

    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Roadmap <review>',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'transcribed',
        startedAt: new Date('2026-03-12T09:30:00Z'),
        endedAt: new Date('2026-03-12T10:00:00Z'),
        location: 'Room 4',
        invitees: [
          { email: 'anna@example.com', name: 'Anna de Vries', declined: false },
          { email: 'daan@example.com', name: 'Daan Jansen', declined: false },
        ],
      })
      .returning();
    if (!meeting) throw new Error('no meeting');
    meetingId = meeting.id;
    const [anna] = await test.db
      .insert(participants)
      .values({ meetingId, displayName: 'Anna de Vries' })
      .returning();
    await test.db.insert(transcriptSegments).values({
      meetingId,
      participantId: anna?.id ?? null,
      startMs: 1000,
      endMs: 2000,
      text: 'The secret transcript sentence.',
    });
    await test.db.insert(chatMessages).values({
      meetingId,
      dedupeKey: 'c1',
      sender: 'Anna de Vries',
      text: 'Notes at https://notes.example/roadmap',
      links: ['https://notes.example/roadmap'],
      sentAt: new Date('2026-03-12T09:31:00Z'),
      offsetMs: 90_000,
    });
    await test.db.insert(summaries).values({
      meetingId,
      provider: 'fake',
      model: 'm',
      status: 'done',
      content: '### Decisions\n\n- Ship it',
    });
  });
  afterAll(async () => {
    await jwks.close();
    await test.close();
  });

  const auth = () => ({ 'cf-access-jwt-assertion': signToken(key), origin: 'http://localhost' });
  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(path, {
      method,
      headers: {
        ...auth(),
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const share = async (
    options: {
      includeTranscript?: boolean;
      includeChat?: boolean;
      includeLinks?: boolean;
      expiresInDays?: number;
    } = {},
    forMeeting = meetingId,
  ) => {
    const row = await createShareLink(test.db, forMeeting, {
      includeTranscript: options.includeTranscript ?? false,
      includeChat: options.includeChat ?? false,
      includeLinks: options.includeLinks ?? false,
      expiresInDays: options.expiresInDays ?? null,
    });
    return {
      id: row.id,
      url: `https://minutes.example/s/${row.token}`,
      includeTranscript: row.includeTranscript,
      expiresAt: row.expiresAt,
    };
  };
  const publicPath = (url: string) => new URL(url).pathname;

  describe('settings', () => {
    it('starts on the classic template without a transcript or logo', async () => {
      const settings = (await (
        await call('GET', '/api/settings/minutes')
      ).json()) as MinutesSettingsDto;
      expect(settings).toMatchObject({
        template: 'classic',
        includeTranscript: false,
        includeChat: false,
        linksTab: false,
        hasLogo: false,
      });
      expect(settings.destinations.map((d) => [d.id, d.enabled, d.available])).toEqual([
        ['share-link', true, true],
        ['doc', false, true],
      ]);
      expect(settings.templates.map((t) => t.id)).toEqual([
        'classic',
        'modern',
        'compact',
        'custom',
      ]);
    });

    it('saves a template and the transcript default and rejects unknown templates', async () => {
      const saved = await call('PUT', '/api/settings/minutes', {
        template: 'modern',
        includeTranscript: true,
        includeChat: false,
        linksTab: false,
        destinations: ['share-link'],
      });
      expect(await saved.json()).toMatchObject({
        template: 'modern',
        includeTranscript: true,
        includeChat: false,
      });
      const bad = await call('PUT', '/api/settings/minutes', {
        template: 'fancy',
        includeTranscript: true,
        includeChat: true,
        linksTab: false,
        destinations: ['share-link'],
      });
      expect(bad.status).toBe(400);
      await call('PUT', '/api/settings/minutes', {
        template: 'classic',
        includeTranscript: false,
        includeChat: true,
        linksTab: false,
        destinations: ['share-link'],
      });
    });

    it('keeps destinations and the links tab, ignoring unknown destinations', async () => {
      const saved = await call('PUT', '/api/settings/minutes', {
        template: 'classic',
        includeTranscript: true,
        includeChat: true,
        linksTab: true,
        destinations: ['doc', 'bogus'],
      });
      const settings = (await saved.json()) as MinutesSettingsDto;
      expect(settings.linksTab).toBe(true);
      expect(settings.destinations.filter((d) => d.enabled).map((d) => d.id)).toEqual(['doc']);
    });

    it('puts the transcript and the links on their own tabs of the share page', async () => {
      const created = await share({ includeTranscript: true, includeLinks: true });
      const html = await (await app.request(publicPath(created.url))).text();
      expect(html).toContain('id="tab-transcript"');
      expect(html).toContain('id="tab-links"');
      expect(html).not.toContain('id="tab-chat"');
      expect(html).toContain(created.url);
      await call('PUT', '/api/settings/minutes', {
        template: 'classic',
        includeTranscript: false,
        includeChat: true,
        linksTab: false,
        destinations: ['share-link'],
      });
    });

    it('stores, serves and removes a logo of an allowed type', async () => {
      const upload = (body: string | Uint8Array) =>
        app.request('/api/settings/minutes/logo', { method: 'PUT', headers: auth(), body });
      expect((await upload(png)).status).toBe(200);
      const served = await call('GET', '/api/settings/minutes/logo');
      expect(served.headers.get('content-type')).toBe('image/png');
      expect(served.headers.get('content-security-policy')).toContain('sandbox');
      expect((await upload(svg)).status).toBe(200);
      expect((await call('GET', '/api/settings/minutes/logo')).headers.get('content-type')).toBe(
        'image/svg+xml',
      );
      const removed = await call('DELETE', '/api/settings/minutes/logo');
      expect(await removed.json()).toMatchObject({ hasLogo: false });
      expect((await call('GET', '/api/settings/minutes/logo')).status).toBe(404);
    });

    it('rejects scripted SVG, other files and oversized logos', async () => {
      const upload = (body: string | Uint8Array) =>
        app.request('/api/settings/minutes/logo', { method: 'PUT', headers: auth(), body });
      expect((await upload('<svg onload="alert(1)"></svg>')).status).toBe(400);
      expect((await upload('<html></html>')).status).toBe(400);
      expect((await upload(new Uint8Array(600 * 1024).fill(0xff))).status).toBe(413);
    });

    it('previews a template on demo data', async () => {
      const { custom } = (await (
        await call('GET', '/api/settings/minutes')
      ).json()) as MinutesSettingsDto;
      const response = await call('POST', '/api/settings/minutes/preview', {
        template: 'compact',
        custom,
        includeTranscript: true,
        includeChat: true,
        linksTab: false,
      });
      const { html } = (await response.json()) as { html: string };
      expect(html).toContain('tpl-compact');
      expect(html).toContain('Transcript');
    });

    it('lists the custom template and stores a validated custom template', async () => {
      const current = (await (
        await call('GET', '/api/settings/minutes')
      ).json()) as MinutesSettingsDto;
      expect(current.templates.map((t) => t.id)).toEqual([
        'classic',
        'modern',
        'compact',
        'custom',
      ]);
      const custom = {
        ...current.custom,
        accent: '#aa3300',
        sections: current.custom.sections.map((section) =>
          section.id === 'summary' ? { ...section, title: 'Samenvatting' } : section,
        ),
      };
      const saved = await call('PUT', '/api/settings/minutes', {
        template: 'custom',
        custom,
        includeTranscript: false,
        includeChat: true,
        linksTab: false,
        destinations: ['share-link'],
      });
      expect(saved.status).toBe(200);
      const after = (await saved.json()) as MinutesSettingsDto;
      expect(after.template).toBe('custom');
      expect(after.custom.accent).toBe('#aa3300');

      const preview = await call('POST', '/api/settings/minutes/preview', {
        template: 'custom',
        custom,
        includeTranscript: false,
        includeChat: true,
        linksTab: false,
      });
      const { html } = (await preview.json()) as { html: string };
      expect(html).toContain('Samenvatting');
      expect(html).toContain('#aa3300');

      const bad = await call('PUT', '/api/settings/minutes', {
        template: 'custom',
        custom: { ...custom, accent: 'red; background: url(//evil)' },
        includeTranscript: false,
        includeChat: true,
        linksTab: false,
        destinations: ['share-link'],
      });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toContain('accent');
      await call('PUT', '/api/settings/minutes', {
        template: 'classic',
        includeTranscript: false,
        includeChat: true,
        linksTab: false,
        destinations: ['share-link'],
      });
    });

    it('checks an imported template and refuses garbage', async () => {
      const good = await call('POST', '/api/settings/minutes/custom/check', { accent: '#112233' });
      expect(good.status).toBe(200);
      expect(((await good.json()) as { accent: string }).accent).toBe('#112233');
      expect(
        (await call('POST', '/api/settings/minutes/custom/check', { font: 'Comic' })).status,
      ).toBe(400);
      expect((await call('POST', '/api/settings/minutes/custom/check', [1, 2])).status).toBe(400);
    });
  });

  describe('share links', () => {
    it('requires a signed-in user to manage links', async () => {
      const response = await app.request(
        `/api/meetings/${meetingId}/shares/${crypto.randomUUID()}`,
        {
          method: 'DELETE',
        },
      );
      expect(response.status).toBe(401);
    });

    it('serves the minutes at an unguessable URL with no login', async () => {
      const created = await share();
      expect(created.url).toMatch(/^https:\/\/minutes\.example\/s\/[A-Za-z0-9_-]{43}$/);
      expect(created.includeTranscript).toBe(false);

      const page = await app.request(publicPath(created.url));
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('Roadmap &lt;review&gt;');
      expect(html).toContain('Anna de Vries');
      expect(html).toContain('Unable to attend');
      expect(html).toContain('Daan Jansen');
      expect(html).toContain('Room 4');
      expect(html).toContain('Ship it');
      expect(html).toContain('Powered by');
      expect(html).not.toContain('secret transcript sentence');
    });

    it('sends privacy headers on every response under /s/', async () => {
      const created = await share();
      for (const path of [publicPath(created.url), '/s/nope', '/s/']) {
        const response = await app.request(path);
        expect(response.headers.get('x-robots-tag')).toContain('noindex');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        expect(response.headers.get('set-cookie')).toBeNull();
      }
    });

    it('follows the visitor colour scheme with a toggle and opens the credit in a new tab', async () => {
      const created = await share();
      const page = await app.request(publicPath(created.url));
      const html = await page.text();
      expect(html).toContain('id="theme-toggle"');
      expect(html).toContain('prefers-color-scheme');
      expect(html).toContain('localStorage');
      expect(html).toMatch(
        /<a href="https:\/\/github\.com\/dennisklappe\/openminutes" target="_blank" rel="noopener noreferrer">OpenMinutes<\/a>/,
      );
      const csp = page.headers.get('content-security-policy') ?? '';
      expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
      const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
      const hash = createHash('sha256').update(script).digest('base64');
      expect(csp).toContain(`'sha256-${hash}'`);
    });

    it('includes the transcript only when the link asks for it', async () => {
      const created = await share({ includeTranscript: true });
      const html = await (await app.request(publicPath(created.url))).text();
      expect(html).toContain('secret transcript sentence');
      expect(html).toContain('00:00:01');
    });

    it('revokes and then refuses a link with the same page as an unknown one', async () => {
      const created = await share();
      await call('POST', `/api/meetings/${meetingId}/export/share-link`, {});

      const revoke = await call('DELETE', `/api/meetings/${meetingId}/shares/${created.id}`);
      expect(revoke.status).toBe(200);
      expect((await call('DELETE', `/api/meetings/${meetingId}/shares/${created.id}`)).status).toBe(
        404,
      );
      const gone = await app.request(publicPath(created.url));
      const unknown = await app.request(`/s/${'A'.repeat(43)}`);
      expect(gone.status).toBe(404);
      expect(await gone.text()).toBe(await unknown.text());
      const records = (await (
        await call('GET', `/api/meetings/${meetingId}/exports`)
      ).json()) as MeetingExportDto[];
      expect(records.map((record) => record.ref)).not.toContain(created.id);
    });

    it('expires links', async () => {
      const created = await share({ expiresInDays: 7 });
      expect(created.expiresAt).not.toBeNull();
      expect((await app.request(publicPath(created.url))).status).toBe(200);
      await test.db
        .update(shareLinks)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(shareLinks.id, created.id));
      expect((await app.request(publicPath(created.url))).status).toBe(404);
    });

    it('refuses unknown links and non-GET methods', async () => {
      expect(
        (await call('DELETE', `/api/meetings/${crypto.randomUUID()}/shares/${crypto.randomUUID()}`))
          .status,
      ).toBe(404);
      const created = await share();
      expect((await app.request(publicPath(created.url), { method: 'POST' })).status).toBe(404);
    });

    it('never needs an Access login, while the app itself does', async () => {
      expect((await app.request('/api/meetings')).status).toBe(401);
      expect((await app.request('/s/nope')).status).toBe(404);
    });

    it('removes the links with the meeting', async () => {
      const [other] = await test.db
        .insert(meetings)
        .values({ title: 'Other', platform: 'teams', joinUrl: 'https://teams.microsoft.com/l/x' })
        .returning();
      const created = await share({}, other?.id ?? '');
      await test.db.delete(meetings).where(eq(meetings.id, other?.id ?? ''));
      expect((await app.request(publicPath(created.url))).status).toBe(404);
    });
  });

  describe('chat', () => {
    const shared = async (options: Parameters<typeof share>[0]) => {
      const created = await share(options);
      return (await app.request(publicPath(created.url))).text();
    };

    it('shows the chat as its own tab of the share page, with or without the transcript', async () => {
      for (const includeTranscript of [true, false]) {
        const html = await shared({ includeTranscript, includeChat: true });
        expect(html).toContain('id="tab-chat"');
        expect(html).toContain('<h2>Chat</h2>');
        expect(html).toContain('<time>00:01:30</time>');
        expect(html).toContain('<a href="https://notes.example/roadmap"');
        expect(html.includes('id="tab-transcript"')).toBe(includeTranscript);
      }
    });

    it('leaves the chat out of links and exports that do not ask for it', async () => {
      expect(await shared({ includeTranscript: true })).not.toContain('notes.example');
      const plain = await call('POST', `/api/meetings/${meetingId}/export/markdown`, {
        includeTranscript: true,
        includeChat: false,
      });
      expect(await plain.text()).not.toContain('notes.example');
      const file = await call('POST', `/api/meetings/${meetingId}/export/markdown`, {
        includeTranscript: true,
        includeChat: true,
      });
      expect(await file.text()).toContain('Anna de Vries: Notes at https://notes.example/roadmap');
    });

    it('previews the chat on demo data only when asked for', async () => {
      const { custom } = (await (
        await call('GET', '/api/settings/minutes')
      ).json()) as MinutesSettingsDto;
      const preview = async (includeChat: boolean) => {
        const response = await call('POST', '/api/settings/minutes/preview', {
          template: 'classic',
          custom,
          includeTranscript: true,
          includeChat,
          linksTab: false,
        });
        return ((await response.json()) as { html: string }).html;
      };
      expect(await preview(true)).toContain('<h2>Chat</h2>');
      expect(await preview(false)).not.toContain('<h2>Chat</h2>');
    });
  });

  describe('what a link shows', () => {
    it('lists the parts of each saved output and applies them to the link', async () => {
      const made = await call('POST', `/api/meetings/${meetingId}/export/share-link`, {
        includeTranscript: true,
        includeChat: true,
      });
      const { url } = (await made.json()) as { url: string };
      const records = (await (
        await call('GET', `/api/meetings/${meetingId}/exports`)
      ).json()) as MeetingExportDto[];
      const record = records.find((r) => r.exporterId === 'share-link');
      expect(record).toMatchObject({
        includeTranscript: true,
        includeChat: true,
        includeLinks: false,
      });
      const html = await (await app.request(publicPath(url))).text();
      expect(html).toContain('id="tab-transcript"');
      expect(html).toContain('id="tab-chat"');
      expect(html).not.toContain('id="tab-links"');
      await call('DELETE', `/api/meetings/${meetingId}/shares/${record?.ref ?? ''}`);
    });

    it('changes the parts of a live link without a new URL', async () => {
      const created = await share({ includeTranscript: true, includeChat: true });
      await test.db
        .insert(meetingExports)
        .values({ meetingId, exporterId: 'share-link', ref: created.id, url: created.url })
        .onConflictDoUpdate({
          target: [meetingExports.meetingId, meetingExports.exporterId],
          set: { ref: created.id, url: created.url },
        });
      const patched = await call('PATCH', `/api/meetings/${meetingId}/shares/${created.id}`, {
        includeTranscript: false,
        includeLinks: true,
      });
      expect(patched.status).toBe(200);
      expect(await patched.json()).toEqual({
        includeTranscript: false,
        includeChat: true,
        includeLinks: true,
      });
      const html = await (await app.request(publicPath(created.url))).text();
      expect(html).not.toContain('id="tab-transcript"');
      expect(html).toContain('id="tab-chat"');
      expect(html).toContain('id="tab-links"');
      const records = (await (
        await call('GET', `/api/meetings/${meetingId}/exports`)
      ).json()) as MeetingExportDto[];
      expect(records.find((r) => r.ref === created.id)).toMatchObject({
        includeTranscript: false,
        includeLinks: true,
      });
      await call('DELETE', `/api/meetings/${meetingId}/shares/${created.id}`);
    });

    it('shows the latest summary through the same link', async () => {
      const created = await share();
      const first = await (await app.request(publicPath(created.url))).text();
      expect(first).toContain('Ship it');
      await test.db
        .update(summaries)
        .set({ content: '### Decisions\n\n- Ship it later' })
        .where(eq(summaries.meetingId, meetingId));
      expect(await (await app.request(publicPath(created.url))).text()).toContain('Ship it later');
    });

    it('refuses empty, invalid and unknown changes', async () => {
      const created = await share();
      const patch = (id: string, body: unknown) =>
        call('PATCH', `/api/meetings/${meetingId}/shares/${id}`, body);
      expect((await patch(created.id, {})).status).toBe(400);
      expect((await patch(created.id, { includeChat: 'yes' })).status).toBe(400);
      expect((await patch(crypto.randomUUID(), { includeChat: true })).status).toBe(404);
      await call('DELETE', `/api/meetings/${meetingId}/shares/${created.id}`);
      expect((await patch(created.id, { includeChat: true })).status).toBe(404);
      const unauthenticated = await app.request(`/api/meetings/${meetingId}/shares/${created.id}`, {
        method: 'PATCH',
        body: '{}',
      });
      expect(unauthenticated.status).toBe(401);
    });
  });

  describe('exports', () => {
    it('lists the registered exporters', async () => {
      const list = (await (await call('GET', '/api/exporters')).json()) as ExporterDto[];
      expect(list.map((e) => [e.id, e.kind, e.enabled])).toEqual([
        ['html', 'download', true],
        ['markdown', 'download', true],
        ['word', 'download', true],
        ['share-link', 'destination', true],
        ['doc', 'destination', false],
      ]);
    });

    it('previews the minutes of a meeting', async () => {
      const html = await (
        await call('GET', `/api/meetings/${meetingId}/minutes?transcript=1`)
      ).text();
      expect(html).toContain('secret transcript sentence');
    });

    it('downloads files and returns links from exporters', async () => {
      const file = await call('POST', `/api/meetings/${meetingId}/export/markdown`, {
        includeTranscript: true,
      });
      expect(file.headers.get('content-disposition')).toBe(
        'attachment; filename="roadmap-review-minutes.md"',
      );
      expect(await file.text()).toContain('secret transcript sentence');
      const link = await call('POST', `/api/meetings/${meetingId}/export/doc`, {});
      expect(await link.json()).toEqual({
        kind: 'link',
        url: `https://docs.example/${meetingId}`,
        label: 'Open doc',
      });
    });

    it('writes times in the instance timezone with its name', async () => {
      const markdown = async () => (await call('GET', `/api/meetings/${meetingId}/minutes`)).text();
      expect(await markdown()).toContain('09:30 to 10:00 UTC');
      expect((await call('PUT', '/api/settings/timezone', { timeZone: 'Mars/Base' })).status).toBe(
        400,
      );
      const saved = await call('PUT', '/api/settings/timezone', { timeZone: 'Europe/Amsterdam' });
      expect(await saved.json()).toEqual({
        timeZone: 'Europe/Amsterdam',
        effective: 'Europe/Amsterdam',
      });
      expect(await markdown()).toContain('10:30 to 11:00 CET');
      const file = await call('POST', `/api/meetings/${meetingId}/export/markdown`, {});
      expect(await file.text()).toContain('10:30 to 11:00 CET');
      await call('PUT', '/api/settings/timezone', { timeZone: 'UTC' });
    });

    it('answers 404 for unknown exporters and meetings', async () => {
      expect((await call('POST', `/api/meetings/${meetingId}/export/nope`, {})).status).toBe(404);
      expect(
        (await call('POST', `/api/meetings/${crypto.randomUUID()}/export/html`, {})).status,
      ).toBe(404);
    });
  });
});
