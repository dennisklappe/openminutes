import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, rememberVoice, SettingsStore } from '@openminutes/core';
import {
  eq,
  meetings,
  participants,
  people,
  speakerEvents,
  summaries,
  transcriptSegments,
  voiceSamples,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { MeetingDto, VoicesDto, VoiceSettingsDto } from './dto.js';
import { assembleMinutes } from './minutes/assemble.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('titles and voices', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  let app: Hono;
  let cookie = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, secret);
    app = createApp({
      db: test.db,
      settings,
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-voices-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
    });
    const created = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    cookie = created.headers.get('set-cookie')?.split(';')[0] ?? '';
  });
  afterAll(() => test.close());

  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...json, cookie },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  async function recording(values: Partial<typeof meetings.$inferInsert> = {}) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Phone recording',
        platform: 'recording',
        joinUrl: '',
        status: 'transcribed',
        ...values,
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    return meeting;
  }

  async function speaker(
    meetingId: string,
    displayName: string,
    values: Partial<typeof participants.$inferInsert> = {},
  ) {
    const [row] = await test.db
      .insert(participants)
      .values({ meetingId, displayName, ...values })
      .returning();
    if (!row) throw new Error('insert failed');
    return row;
  }

  const talk = (meetingId: string, participantId: string, startS: number, lengthS: number) =>
    test.db.insert(transcriptSegments).values({
      meetingId,
      participantId,
      startMs: startS * 1000,
      endMs: (startS + lengthS) * 1000,
      text: `A sentence from second ${String(startS)}.`,
    });

  const voicesOf = async (id: string) =>
    (await (await call('GET', `/meetings/${id}/voices`)).json()) as VoicesDto;

  describe('titles', () => {
    it('edits the title and marks it as edited', async () => {
      const meeting = await recording();
      const response = await call('PATCH', `/meetings/${meeting.id}`, {
        title: '  Call with Anna ',
      });
      expect(response.status).toBe(200);
      expect((await response.json()) as MeetingDto).toMatchObject({
        title: 'Call with Anna',
        titleEdited: true,
      });
      const [row] = await test.db.select().from(meetings).where(eq(meetings.id, meeting.id));
      expect(row).toMatchObject({ title: 'Call with Anna', titleEdited: true });
    });

    it('rejects empty, long and control character titles, and unknown meetings', async () => {
      const meeting = await recording();
      for (const title of ['   ', 'x'.repeat(201), 'a\nb', 'a\u0000b']) {
        expect((await call('PATCH', `/meetings/${meeting.id}`, { title })).status).toBe(400);
      }
      expect((await call('PATCH', `/meetings/${meeting.id}`, {})).status).toBe(400);
      const missing = '00000000-0000-4000-8000-000000000000';
      expect((await call('PATCH', `/meetings/${missing}`, { title: 'x' })).status).toBe(404);
      expect((await call('PATCH', '/meetings/nope', { title: 'x' })).status).toBe(404);
    });

    it('requires a session', async () => {
      const meeting = await recording();
      const response = await app.request(`/api/meetings/${meeting.id}`, {
        method: 'PATCH',
        headers: json,
        body: JSON.stringify({ title: 'x' }),
      });
      expect(response.status).toBe(401);
    });
  });

  describe('listing voices', () => {
    it('lists speakers with time, snippets and merged suggestions', async () => {
      const meeting = await recording({
        invitees: [
          { email: 'daan@example.com', name: 'Daan', declined: false },
          { email: 'eva@example.com', name: null, declined: false },
        ],
      });
      const one = await speaker(meeting.id, 'Speaker 1', {
        nameSuggestions: [
          { name: 'Anna', source: 'conversation' },
          { name: 'Daan', source: 'voice' },
        ],
      });
      const two = await speaker(meeting.id, 'Bram');
      await speaker(meeting.id, 'Silent bot');
      await talk(meeting.id, one.id, 0, 5);
      await talk(meeting.id, one.id, 60, 8);
      await talk(meeting.id, one.id, 120, 1);
      await talk(meeting.id, two.id, 30, 4);

      const voices = await voicesOf(meeting.id);
      expect(voices).toMatchObject({ needsNaming: true, rememberEnabled: false });
      expect(voices.voices.map((v) => v.name)).toEqual(['Speaker 1', 'Bram']);
      const [first, second] = voices.voices;
      expect(first).toMatchObject({ id: one.id, confirmed: false, durationMs: 14_000 });
      expect(first?.snippets.map((s) => [s.startMs, s.endMs])).toEqual([
        [0, 5000],
        [60_000, 68_000],
      ]);
      expect(first?.suggestions).toEqual([
        { name: 'Anna', source: 'conversation' },
        { name: 'Daan', source: 'voice' },
        { name: 'eva@example.com', source: 'calendar' },
        { name: 'Bram', source: 'participant' },
      ]);
      expect(second?.suggestions.map((s) => s.name)).toEqual(['Daan', 'eva@example.com']);
    });

    it('does not ask for names on other platforms or once everything is named', async () => {
      const meet = await recording({ platform: 'meet', joinUrl: 'https://meet.google.com/a-b-c' });
      const generic = await speaker(meet.id, 'Speaker 1');
      await talk(meet.id, generic.id, 0, 5);
      expect((await voicesOf(meet.id)).needsNaming).toBe(false);

      const done = await recording();
      const named = await speaker(done.id, 'Speaker 1', { nameConfirmed: true });
      await talk(done.id, named.id, 0, 5);
      expect((await voicesOf(done.id)).needsNaming).toBe(false);
    });

    it('returns 404 for an unknown meeting', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      expect((await call('GET', `/meetings/${missing}/voices`)).status).toBe(404);
    });
  });

  describe('naming', () => {
    it('names a voice, rewrites the latest summary and shows it everywhere', async () => {
      const meeting = await recording();
      const one = await speaker(meeting.id, 'Speaker 1');
      const two = await speaker(meeting.id, 'Speaker 2');
      await talk(meeting.id, one.id, 0, 5);
      await talk(meeting.id, two.id, 10, 5);
      await test.db.insert(summaries).values([
        {
          meetingId: meeting.id,
          provider: 'p',
          model: 'm',
          status: 'done',
          content: 'old Speaker 1',
          createdAt: new Date('2026-01-01'),
        },
        {
          meetingId: meeting.id,
          provider: 'p',
          model: 'm',
          status: 'done',
          content: 'Speaker 1 asked Speaker 10 and Speaker 2. Speaker 1 left.',
        },
      ]);

      const response = await call('PUT', `/meetings/${meeting.id}/voices/${one.id}`, {
        name: ' Anna ',
      });
      expect(response.status).toBe(200);
      const voices = (await response.json()) as VoicesDto;
      expect(voices.voices.map((v) => [v.name, v.confirmed])).toEqual([
        ['Anna', true],
        ['Speaker 2', false],
      ]);
      expect(voices.needsNaming).toBe(true);

      const minutes = await assembleMinutes({ db: test.db, settings }, meeting.id);
      expect(minutes?.summary).toBe('Anna asked Speaker 10 and Speaker 2. Anna left.');
      expect(minutes?.transcript.map((s) => s.speaker)).toContain('Anna');
      const rows = await test.db
        .select()
        .from(summaries)
        .where(eq(summaries.meetingId, meeting.id));
      expect(rows.map((r) => r.content)).toContain('old Speaker 1');

      await call('PUT', `/meetings/${meeting.id}/voices/${two.id}`, { name: 'Bram' });
      expect((await voicesOf(meeting.id)).needsNaming).toBe(false);
    });

    it('merges a voice into an existing participant with the same name', async () => {
      const meeting = await recording();
      const anna = await speaker(meeting.id, 'Anna', { nameConfirmed: true });
      const split = await speaker(meeting.id, 'Speaker 2', { voiceEmbedding: [1, 0] });
      await talk(meeting.id, anna.id, 0, 5);
      await talk(meeting.id, split.id, 20, 5);
      await test.db.insert(speakerEvents).values({
        meetingId: meeting.id,
        participantId: split.id,
        startMs: 20_000,
        endMs: 25_000,
      });

      const response = await call('PUT', `/meetings/${meeting.id}/voices/${split.id}`, {
        name: 'anna',
      });
      const voices = (await response.json()) as VoicesDto;
      expect(voices.voices).toHaveLength(1);
      expect(voices.voices[0]).toMatchObject({ id: anna.id, name: 'anna', durationMs: 10_000 });
      const left = await test.db
        .select()
        .from(participants)
        .where(eq(participants.meetingId, meeting.id));
      expect(left.map((p) => p.id)).toEqual([anna.id]);
      expect(left[0]?.voiceEmbedding).toEqual([1, 0]);
      const events = await test.db
        .select()
        .from(speakerEvents)
        .where(eq(speakerEvents.meetingId, meeting.id));
      expect(events.map((e) => e.participantId)).toEqual([anna.id]);
    });

    it('rejects bad names and voices of other meetings', async () => {
      const meeting = await recording();
      const other = await recording();
      const mine = await speaker(meeting.id, 'Speaker 1');
      const theirs = await speaker(other.id, 'Speaker 1');
      const path = (id: string) => `/meetings/${meeting.id}/voices/${id}`;
      for (const name of ['', '  ', 'x'.repeat(81), 'a\nb']) {
        expect((await call('PUT', path(mine.id), { name })).status).toBe(400);
      }
      expect((await call('PUT', path(theirs.id), { name: 'Anna' })).status).toBe(404);
      expect((await call('PUT', path('nope'), { name: 'Anna' })).status).toBe(404);
    });
  });

  describe('remembering voices', () => {
    async function namedVoice(name: string, embedding: number[], remember: boolean) {
      const meeting = await recording();
      const voice = await speaker(meeting.id, 'Speaker 1', { voiceEmbedding: embedding });
      await talk(meeting.id, voice.id, 0, 5);
      await call('PUT', `/meetings/${meeting.id}/voices/${voice.id}`, { name, remember });
      return meeting;
    }

    it('stores nothing while the setting is off', async () => {
      await namedVoice('Anna', [1, 0], true);
      expect(await test.db.select().from(voiceSamples)).toEqual([]);
      const [anna] = await test.db.select().from(people).where(eq(people.name, 'Anna'));
      expect(anna?.voicePrototypes).toEqual([]);
    });

    it('stores, averages and suggests voices once the setting is on', async () => {
      const on = await call('PUT', '/settings/voices', { remember: true });
      expect(((await on.json()) as VoiceSettingsDto).remember).toBe(true);

      await namedVoice('Anna', [1, 0], true);
      await namedVoice('Anna', [0, 1], true);
      await namedVoice('Bram', [0, 1], false);
      const [anna] = await test.db.select().from(people).where(eq(people.name, 'Anna'));
      expect(anna?.voicePrototypes).toEqual([
        { vector: [1, 0], samples: 1 },
        { vector: [0, 1], samples: 1 },
      ]);
      const [bram] = await test.db.select().from(people).where(eq(people.name, 'Bram'));
      expect(bram?.voicePrototypes).toEqual([]);
      expect(await test.db.select().from(voiceSamples)).toHaveLength(2);

      const meeting = await recording();
      const voice = await speaker(meeting.id, 'Speaker 1', { voiceEmbedding: [1, 1] });
      await talk(meeting.id, voice.id, 0, 5);
      const voices = await voicesOf(meeting.id);
      expect(voices.rememberEnabled).toBe(true);
      expect(voices.voices[0]?.suggestions).toEqual([{ name: 'Anna', source: 'voice' }]);
    });

    it('lists, deletes and forgets known voices without exposing embeddings', async () => {
      await rememberVoice(test.db, 'Zoe', [1, 0, 0]);
      const response = await call('GET', '/settings/voices');
      const text = await response.text();
      expect(text).not.toContain('embedding');
      const settings = JSON.parse(text) as VoiceSettingsDto;
      expect(settings.known.map((k) => k.name)).toEqual(['Anna', 'Zoe']);
      expect(settings.known[0]).toEqual({
        id: expect.any(String) as string,
        name: 'Anna',
        samples: 2,
        updatedAt: expect.any(String) as string,
      });

      const zoe = settings.known[1];
      const afterDelete = await call('DELETE', `/settings/voices/${zoe?.id ?? ''}`);
      expect(((await afterDelete.json()) as VoiceSettingsDto).known.map((k) => k.name)).toEqual([
        'Anna',
      ]);
      expect((await call('DELETE', `/settings/voices/${zoe?.id ?? ''}`)).status).toBe(404);

      const forgotten = await call('DELETE', '/settings/voices');
      expect(((await forgotten.json()) as VoiceSettingsDto).known).toEqual([]);
      expect(await test.db.select().from(voiceSamples)).toEqual([]);
      expect(
        (await test.db.select().from(people)).every((p) => p.voicePrototypes.length === 0),
      ).toBe(true);
    });

    it('never leaks embeddings through the voices API', async () => {
      const meeting = await recording();
      const voice = await speaker(meeting.id, 'Speaker 1', { voiceEmbedding: [0.123, 0.456] });
      await talk(meeting.id, voice.id, 0, 5);
      const text = await (await call('GET', `/meetings/${meeting.id}/voices`)).text();
      expect(text).not.toMatch(/embedding|0\.123/);
    });

    it('rejects an invalid setting', async () => {
      expect((await call('PUT', '/settings/voices', { remember: 'yes' })).status).toBe(400);
    });
  });
});
