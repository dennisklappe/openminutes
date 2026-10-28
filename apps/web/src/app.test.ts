import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore, type JobName, type JobPayloads } from '@openminutes/core';
import {
  audioFiles,
  chatMessages,
  eq,
  meetings,
  participants,
  summaries,
  transcriptSegments,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { LoginRateLimiter } from './auth/rate-limit.js';
import type { MeetingDetailDto, MeetingDto, MeetingListItemDto, SessionDto } from './dto.js';

const secret = 'a-long-enough-test-secret';
const password = 'correct horse battery';
const json = { 'content-type': 'application/json' };

describe('web API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: LocalStorage;
  let app: Hono;
  let cookie = '';
  const sent: { name: JobName; payload: JobPayloads[JobName] }[] = [];

  beforeAll(async () => {
    test = await createTestDatabase();
    storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-web-')));
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage,
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: {
        send: (name, payload) => {
          sent.push({ name, payload });
          return Promise.resolve();
        },
      },
    });
  });
  afterAll(() => test.close());

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { ...json, ...headers },
      body: JSON.stringify(body),
    });
  const authed = () => ({ cookie });

  it('reports its version without a session', async () => {
    const response = await app.request('/api/version');
    expect(await response.json()).toEqual({ version: '1.2.3' });
  });

  it('asks for setup first and rejects unauthenticated requests', async () => {
    const session = (await (await app.request('/api/session')).json()) as SessionDto;
    expect(session).toEqual({ setupRequired: true, authenticated: false });
    expect((await app.request('/api/meetings')).status).toBe(401);
  });

  it('creates the admin once and signs in with a session cookie', async () => {
    expect((await post('/api/setup', { password: 'short' })).status).toBe(400);

    const created = await post('/api/setup', { password });
    expect(created.status).toBe(201);
    cookie = created.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toContain('openminutes_session=');
    expect((await post('/api/setup', { password: 'another password' })).status).toBe(409);

    const session = (await (
      await app.request('/api/session', { headers: authed() })
    ).json()) as SessionDto;
    expect(session).toEqual({ setupRequired: false, authenticated: true });
  });

  it('sends /login to the root', async () => {
    const response = await app.request('/login');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
  });

  it('rejects wrong passwords and forged cookies', async () => {
    expect((await post('/api/login', { password: 'nope nope nope' })).status).toBe(401);
    expect((await post('/api/login', { password })).status).toBe(200);
    const forged = { cookie: 'openminutes_session=99999999999999.forged' };
    expect((await app.request('/api/meetings', { headers: forged })).status).toBe(401);
  });

  it('queues a meeting from a Meet link and lists it', async () => {
    const response = await post(
      '/api/meetings',
      { url: 'https://meet.google.com/abc-defg-hij' },
      authed(),
    );
    expect(response.status).toBe(201);
    const meeting = (await response.json()) as MeetingDto;
    expect(meeting).toMatchObject({ platform: 'meet', status: 'scheduled' });
    expect(sent.at(-1)).toEqual({ name: 'meeting.schedule', payload: { meetingId: meeting.id } });

    const list = (await (
      await app.request('/api/meetings', { headers: authed() })
    ).json()) as MeetingListItemDto[];
    expect(list.map((m) => m.id)).toContain(meeting.id);
    expect(list.find((m) => m.id === meeting.id)).toMatchObject({
      durationMs: null,
      participantCount: 0,
      scheduledStart: null,
    });
  });

  it('rejects unsupported links and bad bodies', async () => {
    const unsupported = await post('/api/meetings', { url: 'https://zoom.us/j/123' }, authed());
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toEqual({
      error: 'Only Google Meet and Microsoft Teams links are supported',
    });
    expect((await post('/api/meetings', {}, authed())).status).toBe(400);
  });

  it('returns 404 for unknown or malformed meeting ids', async () => {
    expect((await app.request('/api/meetings/not-a-uuid', { headers: authed() })).status).toBe(404);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await app.request(`/api/meetings/${missing}`, { headers: authed() })).status).toBe(404);
  });

  async function insertMeeting(values: Partial<typeof meetings.$inferInsert> = {}) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Weekly sync',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        ...values,
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    return meeting;
  }

  it('orders the list by when the meeting happened, not when its row was created', async () => {
    const synced = await insertMeeting({
      title: 'Synced early, held later',
      createdAt: new Date('2026-10-01T08:00:00Z'),
      scheduledStart: new Date('2026-10-23T13:00:00Z'),
      startedAt: new Date('2026-10-23T12:59:00Z'),
    });
    const newer = await insertMeeting({
      title: 'Created later, held earlier',
      createdAt: new Date('2026-10-22T08:00:00Z'),
      startedAt: new Date('2026-10-23T09:00:00Z'),
    });
    const list = (await (
      await app.request('/api/meetings', { headers: authed() })
    ).json()) as MeetingListItemDto[];
    const ids = list.map((m) => m.id);
    expect(ids.indexOf(synced.id)).toBeLessThan(ids.indexOf(newer.id));
  });

  const detailOf = async (id: string) =>
    (await (
      await app.request(`/api/meetings/${id}`, { headers: authed() })
    ).json()) as MeetingDetailDto;

  it('serves the merged audio with range support and as a download', async () => {
    const meeting = await insertMeeting();
    expect((await detailOf(meeting.id)).audio).toBeNull();
    const missing = await app.request(`/api/meetings/${meeting.id}/audio`, { headers: authed() });
    expect(missing.status).toBe(404);

    const directory = await storage.ensureDirectory(`meetings/${meeting.id}`);
    await writeFile(join(directory, 'merged.opus'), '0123456789');
    await test.db.insert(audioFiles).values([
      { meetingId: meeting.id, path: 'a/000.opus', durationMs: 1000, codec: 'opus', size: 5 },
      { meetingId: meeting.id, path: 'a/001.opus', durationMs: 500, codec: 'opus', size: 5 },
    ]);
    expect((await detailOf(meeting.id)).audio).toEqual({ durationMs: 1500, size: 10 });

    const url = `/api/meetings/${meeting.id}/audio`;
    const whole = await app.request(url, { headers: authed() });
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-disposition')).toBeNull();
    expect(await whole.text()).toBe('0123456789');

    const part = await app.request(url, { headers: { ...authed(), range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');

    const tail = await app.request(url, { headers: { ...authed(), range: 'bytes=-3' } });
    expect(await tail.text()).toBe('789');
    expect((await app.request(url, { headers: { ...authed(), range: 'bytes=50-' } })).status).toBe(
      416,
    );
    expect((await app.request(url)).status).toBe(401);

    const download = await app.request(`${url}?download`, { headers: authed() });
    expect(download.headers.get('content-disposition')).toBe(
      'attachment; filename="weekly-sync.opus"',
    );
  });

  it('lists transcript segments in order and exports them', async () => {
    const meeting = await insertMeeting({ title: 'Q3 review: plans' });
    const [alice] = await test.db
      .insert(participants)
      .values({ meetingId: meeting.id, displayName: 'Alice' })
      .returning();
    await test.db.insert(transcriptSegments).values([
      {
        meetingId: meeting.id,
        participantId: alice?.id ?? null,
        startMs: 4000,
        endMs: 6000,
        text: 'Second.',
      },
      { meetingId: meeting.id, startMs: 1000, endMs: 3000, text: 'First.' },
    ]);

    const detail = await detailOf(meeting.id);
    expect(detail.segments.map((s) => [s.speaker, s.text])).toEqual([
      [null, 'First.'],
      ['Alice', 'Second.'],
    ]);

    const markdown = await app.request(`/api/meetings/${meeting.id}/transcript.md`, {
      headers: authed(),
    });
    expect(markdown.headers.get('content-disposition')).toContain('q3-review-plans.md');
    expect(await markdown.text()).toBe(
      '# Q3 review: plans\n\n## Transcript\n\n**00:00:01** First.\n\n**00:00:04** Alice: Second.\n',
    );

    const json = await app.request(`/api/meetings/${meeting.id}/transcript.json`, {
      headers: authed(),
    });
    expect(await json.json()).toMatchObject({
      title: 'Q3 review: plans',
      segments: [
        { startMs: 1000, endMs: 3000, speaker: null, text: 'First.' },
        { startMs: 4000, endMs: 6000, speaker: 'Alice', text: 'Second.' },
      ],
    });
  });

  it('returns chat in transcript time and interleaves it into the exports', async () => {
    const meeting = await insertMeeting({ title: 'Q3', trimStartMs: 10_000, trimEndMs: 100_000 });
    expect((await detailOf(meeting.id)).chat).toEqual([]);
    const sentAt = new Date('2026-10-22T10:00:00Z');
    await test.db.insert(transcriptSegments).values([
      { meetingId: meeting.id, startMs: 1000, endMs: 3000, text: 'First.' },
      { meetingId: meeting.id, startMs: 9000, endMs: 11_000, text: 'Later.' },
    ]);
    await test.db.insert(chatMessages).values([
      {
        meetingId: meeting.id,
        dedupeKey: 'b',
        sender: 'Bob',
        text: 'Late https://example.com',
        links: ['https://example.com'],
        sentAt,
        offsetMs: 18_000,
      },
      {
        meetingId: meeting.id,
        dedupeKey: 'a',
        sender: 'Alice',
        text: 'Early',
        links: [],
        sentAt,
        offsetMs: 2000,
      },
    ]);

    expect((await detailOf(meeting.id)).chat).toEqual([
      expect.objectContaining({ sender: 'Alice', offsetMs: 0, sentAt: sentAt.toISOString() }),
      expect.objectContaining({
        sender: 'Bob',
        offsetMs: 8000,
        links: ['https://example.com'],
        text: 'Late https://example.com',
      }),
    ]);

    const markdown = await app.request(`/api/meetings/${meeting.id}/transcript.md`, {
      headers: authed(),
    });
    expect(await markdown.text()).toBe(
      '# Q3\n\n## Transcript\n\n**00:00:00** _Chat, Alice:_ Early\n\n**00:00:01** First.\n\n**00:00:08** _Chat, Bob:_ Late https://example.com\n\n**00:00:09** Later.\n',
    );
    const json = (await (
      await app.request(`/api/meetings/${meeting.id}/transcript.json`, { headers: authed() })
    ).json()) as { chat: unknown[] };
    expect(json.chat).toEqual([
      { sender: 'Alice', text: 'Early', links: [], sentAt: sentAt.toISOString(), offsetMs: 0 },
      {
        sender: 'Bob',
        text: 'Late https://example.com',
        links: ['https://example.com'],
        sentAt: sentAt.toISOString(),
        offsetMs: 8000,
      },
    ]);
  });

  it('queues a re-process only for meetings that have audio and are idle', async () => {
    const meeting = await insertMeeting({ status: 'transcribed', error: 'old' });
    const rerun = (action = 'reprocess') =>
      app.request(`/api/meetings/${meeting.id}/${action}`, {
        method: 'POST',
        headers: { ...json, ...authed() },
      });
    expect((await detailOf(meeting.id)).canTranscribe).toBe(false);
    expect((await rerun()).status).toBe(409);

    await test.db
      .insert(audioFiles)
      .values({ meetingId: meeting.id, path: 'x/000.opus', durationMs: 1, codec: 'opus', size: 1 });
    expect((await detailOf(meeting.id)).canTranscribe).toBe(true);
    expect((await rerun()).status).toBe(202);
    expect(sent.at(-1)).toEqual({ name: 'meeting.process', payload: { meetingId: meeting.id } });

    const after = (await detailOf(meeting.id)).meeting;
    expect(after).toMatchObject({ status: 'processing', error: null });
    expect((await rerun()).status).toBe(409);
    expect((await rerun('transcribe')).status).toBe(409);
  });

  it('passes the language of a re-run to the job and rejects nonsense', async () => {
    const meeting = await insertMeeting({ status: 'transcribed' });
    await test.db
      .insert(audioFiles)
      .values({ meetingId: meeting.id, path: 'y/000.opus', durationMs: 1, codec: 'opus', size: 1 });
    const rerun = (language: string) =>
      app.request(`/api/meetings/${meeting.id}/reprocess`, {
        method: 'POST',
        headers: { ...json, ...authed() },
        body: JSON.stringify({ language }),
      });
    expect((await rerun('Dutch!')).status).toBe(400);
    expect((await rerun('nl')).status).toBe(202);
    expect(sent.at(-1)).toEqual({
      name: 'meeting.process',
      payload: { meetingId: meeting.id, language: 'nl' },
    });
  });

  it('stores the speaker count of a re-run, clears it for automatic and rejects nonsense', async () => {
    const meeting = await insertMeeting({ status: 'transcribed' });
    await test.db
      .insert(audioFiles)
      .values({ meetingId: meeting.id, path: 'z/000.opus', durationMs: 1, codec: 'opus', size: 1 });
    const rerun = async (body: unknown) => {
      const response = await app.request(`/api/meetings/${meeting.id}/reprocess`, {
        method: 'POST',
        headers: { ...json, ...authed() },
        body: JSON.stringify(body),
      });
      await test.db
        .update(meetings)
        .set({ status: 'transcribed' })
        .where(eq(meetings.id, meeting.id));
      return response;
    };
    const stored = async () => (await detailOf(meeting.id)).meeting.speakerCount;

    expect((await rerun({ speakers: 1 })).status).toBe(400);
    expect((await rerun({ speakers: 6 })).status).toBe(400);
    expect(await stored()).toBeNull();
    expect((await rerun({ speakers: 3 })).status).toBe(202);
    expect(await stored()).toBe(3);
    expect((await rerun({ language: 'nl' })).status).toBe(202);
    expect(await stored()).toBe(3);
    expect((await rerun({ speakers: null })).status).toBe(202);
    expect(await stored()).toBeNull();
  });

  it('shows the progress of a meeting in processing and lets it be cancelled', async () => {
    const meeting = await insertMeeting({
      status: 'processing',
      processingStep: 'transcribing',
      processingCurrent: 3,
      processingTotal: 5,
      processingStartedAt: new Date('2026-10-23T10:00:00Z'),
    });
    expect((await detailOf(meeting.id)).meeting.progress).toEqual({
      step: 'transcribing',
      current: 3,
      total: 5,
      startedAt: '2026-10-23T10:00:00.000Z',
    });
    const cancel = () =>
      app.request(`/api/meetings/${meeting.id}/cancel`, {
        method: 'POST',
        headers: { ...json, ...authed() },
      });

    expect((await cancel()).status).toBe(200);
    const after = (await detailOf(meeting.id)).meeting;
    expect(after).toMatchObject({ status: 'failed', progress: null });
    expect(after.error).toMatch(/Re-run/);
    expect((await cancel()).status).toBe(409);
  });

  it('requires a login to re-process', async () => {
    const meeting = await insertMeeting({ status: 'transcribed' });
    const response = await app.request(`/api/meetings/${meeting.id}/reprocess`, {
      method: 'POST',
      headers: { origin: 'http://localhost' },
    });
    expect(response.status).toBe(401);
  });

  it('reports the trimmed length as the audio duration', async () => {
    const meeting = await insertMeeting({
      status: 'transcribed',
      trimStartMs: 87_000,
      trimEndMs: 252_000,
    });
    await test.db.insert(audioFiles).values({
      meetingId: meeting.id,
      path: `meetings/${meeting.id}/000.opus`,
      durationMs: 330_000,
      codec: 'opus',
      size: 1,
    });
    await storage.write(`meetings/${meeting.id}/merged.opus`, Buffer.from('opus'));
    expect((await detailOf(meeting.id)).audio).toMatchObject({ durationMs: 165_000 });
  });

  describe('summaries', () => {
    const put = (path: string, body: unknown) =>
      app.request(path, {
        method: 'PUT',
        headers: { ...json, ...authed() },
        body: JSON.stringify(body),
      });
    const request = (id: string, body: unknown = {}) =>
      app.request(`/api/meetings/${id}/summaries`, {
        method: 'POST',
        headers: { ...json, ...authed() },
        body: JSON.stringify(body),
      });

    it('needs a transcript and a configured provider before queueing', async () => {
      const meeting = await insertMeeting({ status: 'transcribed' });
      expect((await request(meeting.id)).status).toBe(409);

      await test.db
        .insert(transcriptSegments)
        .values({ meetingId: meeting.id, startMs: 0, endMs: 1000, text: 'Hello.' });
      expect((await request(meeting.id)).status).toBe(400);
      expect((await detailOf(meeting.id)).summaryOptions.providers).toEqual([]);
    });

    it('queues a summary, lists the history and exports the latest finished one', async () => {
      await put('/api/settings/summary', {
        provider: 'openai-compatible',
        config: { baseUrl: 'http://llm:11434/v1', model: 'llama3' },
      });
      const meeting = await insertMeeting({ title: 'Plan', status: 'transcribed' });
      await test.db
        .insert(transcriptSegments)
        .values({ meetingId: meeting.id, startMs: 0, endMs: 1000, text: 'Hello.' });

      expect((await request(meeting.id, { promptId: 'missing' })).status).toBe(400);
      expect((await request(meeting.id, { provider: 'anthropic' })).status).toBe(400);
      expect((await request(meeting.id)).status).toBe(202);
      const queued = sent.at(-1);
      expect(queued?.name).toBe('meeting.summarize');

      let detail = await detailOf(meeting.id);
      expect(detail.summaries).toMatchObject([
        {
          provider: 'openai-compatible',
          model: 'llama3',
          promptName: 'Meeting summary',
          status: 'pending',
        },
      ]);
      expect(detail.summaryOptions).toMatchObject({
        providers: [{ id: 'openai-compatible' }],
        prompts: [{ id: 'default', name: 'Meeting summary' }],
        defaultPromptId: 'default',
      });

      await test.db.update(summaries).set({ status: 'done', content: '## Summary\n\nWe agreed.' });
      await request(meeting.id);
      detail = await detailOf(meeting.id);
      expect(detail.summaries.map((s) => s.status)).toEqual(['pending', 'done']);

      const markdown = await app.request(`/api/meetings/${meeting.id}/transcript.md`, {
        headers: authed(),
      });
      expect(await markdown.text()).toBe(
        '# Plan\n\n## Summary\n\nWe agreed.\n\n## Transcript\n\n**00:00:00** Hello.\n',
      );
      const exported = (await (
        await app.request(`/api/meetings/${meeting.id}/transcript.json`, { headers: authed() })
      ).json()) as { summaries: { model: string; content: string }[] };
      expect(exported.summaries).toMatchObject([
        { model: 'llama3', content: '## Summary\n\nWe agreed.' },
      ]);
    });
  });

  it('filters the list by search text, platform and status', async () => {
    const budget = await insertMeeting({ title: 'Budget planning', status: 'cancelled' });
    const standup = await insertMeeting({
      title: 'Standup',
      platform: 'teams',
      joinUrl: 'https://teams.microsoft.com/meet/123456789012?p=abc',
      status: 'failed',
    });
    await test.db
      .insert(transcriptSegments)
      .values({ meetingId: standup.id, startMs: 0, endMs: 1000, text: 'We discussed the roadmap' });
    const ids = async (query: string) =>
      (
        (await (
          await app.request(`/api/meetings?${query}`, { headers: authed() })
        ).json()) as MeetingDto[]
      ).map((m) => m.id);

    expect(await ids('q=budget')).toEqual([budget.id]);
    expect(await ids('q=ROADMAP')).toEqual([standup.id]);
    expect(await ids('platform=teams')).toEqual([standup.id]);
    expect(await ids('status=cancelled')).toEqual([budget.id]);
    expect(await ids('status=cancelled,transcribed')).toEqual(expect.arrayContaining([budget.id]));
    expect(await ids('status=transcribed,failed')).not.toContain(budget.id);
    expect((await app.request('/api/meetings?status=bogus', { headers: authed() })).status).toBe(
      400,
    );
    expect(await ids('q=budget&platform=teams')).toEqual([]);
    expect(await ids('q=%25')).toEqual([]);
    expect((await app.request('/api/meetings?platform=zoom', { headers: authed() })).status).toBe(
      400,
    );
  });

  describe('skipping upcoming meetings', () => {
    const hours = (n: number) => new Date(Date.now() + n * 3_600_000);
    const call = (id: string, action: string, method = 'POST') =>
      app.request(`/api/meetings/${id}${action}`, {
        method,
        headers: { ...authed(), origin: 'http://localhost' },
      });

    it('skips a scheduled meeting, joins again and refuses to delete it', async () => {
      const meeting = await insertMeeting({ status: 'scheduled', scheduledStart: hours(3) });
      expect(await detailOf(meeting.id)).toMatchObject({
        canSkip: true,
        canRejoin: false,
        canDelete: false,
      });
      expect((await call(meeting.id, '', 'DELETE')).status).toBe(409);

      expect((await call(meeting.id, '/skip')).status).toBe(200);
      expect(await detailOf(meeting.id)).toMatchObject({
        meeting: { status: 'skipped' },
        canSkip: false,
        canRejoin: true,
        canDelete: false,
      });
      expect((await call(meeting.id, '', 'DELETE')).status).toBe(409);

      sent.length = 0;
      expect((await call(meeting.id, '/rejoin')).status).toBe(200);
      expect((await detailOf(meeting.id)).meeting.status).toBe('scheduled');
      expect(sent).toEqual([{ name: 'meeting.schedule', payload: { meetingId: meeting.id } }]);
    });

    it('only skips what has not started and only rejoins what was skipped', async () => {
      const recording = await insertMeeting({ status: 'recording' });
      expect((await call(recording.id, '/skip')).status).toBe(409);
      const scheduled = await insertMeeting({ status: 'scheduled', scheduledStart: hours(3) });
      expect((await call(scheduled.id, '/rejoin')).status).toBe(409);
      const started = await insertMeeting({ status: 'skipped', scheduledStart: hours(-1) });
      expect((await call(started.id, '/rejoin')).status).toBe(409);
      expect(await detailOf(started.id)).toMatchObject({ canRejoin: false, canDelete: true });
      expect((await call(crypto.randomUUID(), '/skip')).status).toBe(404);
    });

    it('skips a whole series, lists it and joins it again from settings', async () => {
      const meeting = await insertMeeting({
        status: 'scheduled',
        scheduledStart: hours(3),
        seriesKey: 'google:weekly',
      });
      const single = await insertMeeting({ status: 'scheduled', scheduledStart: hours(3) });
      expect((await call(single.id, '/skip-series')).status).toBe(409);
      expect((await detailOf(meeting.id)).series).toEqual({ skippedId: null });

      expect((await call(meeting.id, '/skip-series')).status).toBe(200);
      const detail = await detailOf(meeting.id);
      expect(detail.meeting.status).toBe('skipped');
      expect(detail.series?.skippedId).toEqual(expect.any(String));

      const listed = (await (
        await app.request('/api/series/skipped', { headers: authed() })
      ).json()) as { id: string; title: string }[];
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(detail.series?.skippedId);

      sent.length = 0;
      const url = `/api/series/skipped/${listed[0]?.id ?? ''}/rejoin`;
      const rejoined = await app.request(url, {
        method: 'POST',
        headers: { ...authed(), origin: 'http://localhost' },
      });
      expect(rejoined.status).toBe(200);
      expect((await detailOf(meeting.id)).meeting.status).toBe('scheduled');
      expect(sent).toHaveLength(1);
    });

    it('lists skipped meetings with their status', async () => {
      const meeting = await insertMeeting({ status: 'skipped', scheduledStart: hours(2) });
      const list = (await (
        await app.request('/api/meetings?status=skipped', { headers: authed() })
      ).json()) as MeetingListItemDto[];
      expect(list.map((m) => m.id)).toContain(meeting.id);
    });
  });

  it('does not delete a meeting while it is running', async () => {
    const running = await insertMeeting({ status: 'recording' });
    const refused = await app.request(`/api/meetings/${running.id}`, {
      method: 'DELETE',
      headers: { ...authed(), origin: 'http://localhost' },
    });
    expect(refused.status).toBe(409);
    expect((await detailOf(running.id)).canDelete).toBe(false);
  });

  it('tells the detail page when retention deleted the audio', async () => {
    const meeting = await insertMeeting({ audioDeletedAt: new Date('2026-10-01T00:00:00Z') });
    const detail = await detailOf(meeting.id);
    expect(detail).toMatchObject({
      audio: null,
      audioDeletedAt: '2026-10-01T00:00:00.000Z',
      canTranscribe: false,
    });
  });

  it('locks out a client after repeated wrong passwords', async () => {
    let now = 0;
    const limited = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage,
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      loginLimiter: new LoginRateLimiter(3, 60_000, () => now),
    });
    const login = (attempt: string) =>
      limited.request('/api/login', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ password: attempt }),
      });

    for (let i = 0; i < 3; i++) expect((await login('wrong password')).status).toBe(401);
    const blocked = await login(password);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');

    now += 61_000;
    expect((await login(password)).status).toBe(200);
  });
});
