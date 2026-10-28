import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore, type JobName } from '@openminutes/core';
import { eq, meetings, participants, people, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { CheckPeopleDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const LONG = 'We went through the whole plan again and agreed on the dates for the next release.';

describe('check the people', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  let app: Hono;
  let cookie = '';
  let sent: { name: JobName; payload: unknown }[] = [];

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, secret);
    app = createApp({
      db: test.db,
      settings,
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-check-'))),
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
    const created = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    cookie = created.headers.get('set-cookie')?.split(';')[0] ?? '';
  });
  afterAll(() => test.close());
  beforeEach(async () => {
    sent = [];
    await test.db.delete(meetings);
    await test.db.delete(people);
    await settings.set('voices.remember', 'false');
    await settings.set('people.checked', '[]');
    await settings.set('export.owner_email', '');
  });

  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...json, cookie },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const check = async (id: string) =>
    (await (await call('GET', `/meetings/${id}/check-people`)).json()) as CheckPeopleDto;

  async function recording(values: Partial<typeof meetings.$inferInsert> = {}) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Phone recording',
        platform: 'recording',
        joinUrl: '',
        status: 'transcribed',
        language: 'en',
        ...values,
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    return meeting;
  }

  async function voice(
    meetingId: string,
    displayName: string,
    embedding: number[] | null,
    values: Partial<typeof participants.$inferInsert> = {},
  ) {
    const [row] = await test.db
      .insert(participants)
      .values({ meetingId, displayName, voiceEmbedding: embedding, ...values })
      .returning();
    if (!row) throw new Error('insert failed');
    for (const startS of [0, 10, 20]) {
      await test.db.insert(transcriptSegments).values({
        meetingId,
        participantId: row.id,
        startMs: startS * 1000,
        endMs: (startS + 6) * 1000,
        text: LONG,
      });
    }
    return row;
  }

  async function known(
    name: string,
    vector: number[] | null,
    values: Partial<typeof people.$inferInsert> = {},
  ) {
    const [row] = await test.db
      .insert(people)
      .values({
        name,
        voicePrototypes: vector ? [{ vector, samples: 4, language: 'en' }] : [],
        ...values,
      })
      .returning();
    if (!row) throw new Error('insert failed');
    return row;
  }

  describe('samples to listen to', () => {
    async function line(
      meetingId: string,
      participantId: string,
      startS: number,
      lengthS: number,
      values: Partial<typeof transcriptSegments.$inferInsert> = {},
    ) {
      const [row] = await test.db
        .insert(transcriptSegments)
        .values({
          meetingId,
          participantId,
          startMs: startS * 1000,
          endMs: (startS + lengthS) * 1000,
          text: LONG,
          ...values,
        })
        .returning();
      if (!row) throw new Error('insert failed');
      return row;
    }

    it('gives each voice up to 3 of its own clean lines with id, times and text', async () => {
      const meeting = await recording();
      const jo = await voice(meeting.id, 'Speaker 1', null);
      const ann = await voice(meeting.id, 'Speaker 2', null);
      await test.db.delete(transcriptSegments).where(eq(transcriptSegments.meetingId, meeting.id));
      const first = await line(meeting.id, jo.id, 5, 8);
      await line(meeting.id, jo.id, 60, 2);
      await line(meeting.id, jo.id, 70, 9, { mixed: 'marked' });
      await line(meeting.id, jo.id, 100, 5);
      await line(meeting.id, jo.id, 200, 6);
      await line(meeting.id, jo.id, 300, 4);
      await line(meeting.id, ann.id, 30, 7, { text: 'Thanks, that works for me as well.' });
      const card = await check(meeting.id);
      const joCard = card.voices.find((v) => v.id === jo.id);
      const annCard = card.voices.find((v) => v.id === ann.id);
      expect(joCard?.samples).toHaveLength(3);
      expect(joCard?.samples.map((s) => s.startMs)).toEqual([5000, 100_000, 200_000]);
      expect(joCard?.samples[0]).toEqual({
        id: first.id,
        startMs: 5000,
        endMs: 13_000,
        text: LONG,
      });
      expect(annCard?.samples).toEqual([
        expect.objectContaining({ startMs: 30_000, text: 'Thanks, that works for me as well.' }),
      ]);
    });

    it('gives a voice without a usable line no samples', async () => {
      const meeting = await recording();
      const jo = await voice(meeting.id, 'Speaker 1', null);
      await test.db.delete(transcriptSegments).where(eq(transcriptSegments.meetingId, meeting.id));
      await line(meeting.id, jo.id, 0, 1);
      expect((await check(meeting.id)).voices[0]?.samples).toEqual([]);
    });
  });

  describe('who is detected', () => {
    it('names the voices from the saved profiles with a certainty and a company hint', async () => {
      await known('Jo Parker', [1, 0, 0], { emails: ['jo@acme.example'] });
      await known('Ann Lee', [0, 1, 0]);
      const meeting = await recording();
      await voice(meeting.id, 'Speaker 1', [1, 0.05, 0]);
      await voice(meeting.id, 'Speaker 2', [0, 0.6, 0.8]);
      const card = await check(meeting.id);
      expect(card.show).toBe(true);
      expect(card.count).toBe(2);
      expect(card.voices[0]?.match).toMatchObject({
        name: 'Jo Parker',
        certainty: 'sure',
        source: 'voice',
        company: { name: 'Acme', source: 'email' },
      });
      expect(card.voices[1]?.match).toMatchObject({ name: 'Ann Lee', certainty: 'probable' });
      expect(card.voices[1]?.match?.company).toBeNull();
    });

    it('gives a voice nobody fits no match, with the attendees as suggestions', async () => {
      await known('Jo Parker', [1, 0, 0], { emails: ['jo@acme.example'] });
      const meeting = await recording({
        invitees: [
          { email: 'jo@acme.example', name: 'Jo Parker', declined: false },
          { email: 'ann@globex.example', name: 'Ann Lee', declined: false },
          { email: 'sam@globex.example', name: 'Sam Roe', declined: false },
        ],
      });
      await voice(meeting.id, 'Speaker 1', [1, 0, 0]);
      await voice(meeting.id, 'Speaker 2', [0, 0, 1]);
      const card = await check(meeting.id);
      expect(card.voices[1]?.match).toBeNull();
      expect(card.voices[1]?.attendees.map((a) => a.name)).toEqual(['Ann Lee', 'Sam Roe']);
      expect(card.voices[0]?.match).toMatchObject({ name: 'Jo Parker', onCalendar: true });
    });

    it('takes the one attendee left for the one voice left', async () => {
      await known('Jo Parker', [1, 0, 0], { emails: ['jo@acme.example'] });
      const meeting = await recording({
        invitees: [
          { email: 'jo@acme.example', name: 'Jo Parker', declined: false },
          { email: 'ann@globex.example', name: 'Ann Lee', declined: false },
        ],
      });
      await voice(meeting.id, 'Speaker 1', [1, 0, 0]);
      await voice(meeting.id, 'Speaker 2', [0, 0, 1]);
      const card = await check(meeting.id);
      expect(card.voices[1]?.match).toMatchObject({
        name: 'Ann Lee',
        certainty: 'probable',
        source: 'calendar',
        email: 'ann@globex.example',
        company: { name: 'Globex', source: 'email' },
      });
    });

    it('uses the calendar event around the recording and leaves out the owner and decliners', async () => {
      const start = new Date('2026-03-02T10:00:00Z');
      await test.db.insert(meetings).values({
        title: 'Planning',
        platform: 'meet',
        joinUrl: 'https://meet.example/abc-defg-hij',
        status: 'transcribed',
        scheduledStart: start,
        invitees: [
          { email: 'me@mine.example', name: 'Me', declined: false },
          { email: 'ann@globex.example', name: 'Ann Lee', declined: false },
          { email: 'sam@globex.example', name: 'Sam Roe', declined: true },
        ],
      });
      await settings.set('export.owner_email', 'me@mine.example');
      const meeting = await recording({ startedAt: new Date('2026-03-02T10:04:00Z') });
      await voice(meeting.id, 'Speaker 1', null);
      const card = await check(meeting.id);
      expect(card.voices[0]?.match).toMatchObject({ name: 'Ann Lee', source: 'calendar' });
      expect(card.options.filter((o) => o.source === 'calendar').map((o) => o.name)).toEqual([
        'Ann Lee',
      ]);
    });

    it('expects as many people as were invited, unless the speakers were set', async () => {
      const invitees = [
        { email: 'jo@acme.example', name: 'Jo Parker', declined: false },
        { email: 'ann@acme.example', name: 'Ann Lee', declined: false },
        { email: 'sam@acme.example', name: 'Sam Roe', declined: true },
      ];
      const invited = await recording({ invitees });
      await voice(invited.id, 'Speaker 1', null);
      expect(await check(invited.id)).toMatchObject({ speakerCount: 2, expectedPeople: 2 });

      const set = await recording({ invitees, speakerCount: 3 });
      await voice(set.id, 'Speaker 1', null);
      expect(await check(set.id)).toMatchObject({ speakerCount: 3, expectedPeople: 2 });

      const alone = await recording();
      await voice(alone.id, 'Speaker 1', null);
      expect(await check(alone.id)).toMatchObject({ speakerCount: null, expectedPeople: null });
    });

    it('hints a company from earlier meetings with the person, never stores it', async () => {
      const jo = await known('Jo Parker', [1, 0, 0]);
      for (const company of ['Initech', 'Initech', 'Globex']) {
        const earlier = await recording({ company });
        await test.db
          .insert(participants)
          .values({ meetingId: earlier.id, displayName: 'Jo Parker', personId: jo.id });
      }
      const meeting = await recording();
      await voice(meeting.id, 'Speaker 1', [1, 0, 0]);
      const card = await check(meeting.id);
      expect(card.voices[0]?.match?.company).toEqual({ name: 'Initech', source: 'earlier' });
      const [row] = await test.db.select().from(meetings).where(eq(meetings.id, meeting.id));
      expect(row?.company).toBeNull();
    });

    it('keeps a name the voice already has as a probable match', async () => {
      const meeting = await recording({ platform: 'imported', joinUrl: 'fireflies:1' });
      await voice(meeting.id, 'Jo Parker', null);
      const card = await check(meeting.id);
      expect(card.voices[0]?.match).toMatchObject({
        name: 'Jo Parker',
        source: 'label',
        certainty: 'probable',
      });
    });
  });

  describe('when it is shown', () => {
    it('is not shown for a call with a roster, a meeting still processing or without voices', async () => {
      const call_ = await recording({ platform: 'meet', joinUrl: 'https://meet.example/x' });
      await voice(call_.id, 'Speaker 1', [1, 0, 0]);
      expect((await check(call_.id)).show).toBe(false);
      const busy = await recording({ status: 'processing' });
      await voice(busy.id, 'Speaker 1', [1, 0, 0]);
      expect((await check(busy.id)).show).toBe(false);
      expect((await check((await recording()).id)).show).toBe(false);
    });

    it('is not shown once every voice is confirmed, nor to a missing meeting', async () => {
      const meeting = await recording();
      await voice(meeting.id, 'Jo Parker', null, { nameConfirmed: true });
      expect((await check(meeting.id)).show).toBe(false);
      expect((await call('GET', `/meetings/${crypto.randomUUID()}/check-people`)).status).toBe(404);
    });

    it('needs a session', async () => {
      const meeting = await recording();
      const response = await app.request(`/api/meetings/${meeting.id}/check-people`);
      expect(response.status).toBe(401);
    });
  });

  describe('dismiss', () => {
    it('hides the card for good and renames nobody', async () => {
      const meeting = await recording();
      await voice(meeting.id, 'Speaker 1', [1, 0, 0]);
      expect((await call('POST', `/meetings/${meeting.id}/check-people/dismiss`)).status).toBe(200);
      expect((await check(meeting.id)).show).toBe(false);
      const rows = await test.db
        .select()
        .from(participants)
        .where(eq(participants.meetingId, meeting.id));
      expect(rows.map((r) => [r.displayName, r.nameConfirmed])).toEqual([['Speaker 1', false]]);
    });
  });

  describe('confirm', () => {
    it('sets the names as confirmed and does not learn while learning is off', async () => {
      const jo = await known('Jo Parker', [1, 0, 0]);
      const meeting = await recording();
      const one = await voice(meeting.id, 'Speaker 1', [1, 0, 0]);
      const response = await call('POST', `/meetings/${meeting.id}/check-people/confirm`, {
        voices: [{ participantId: one.id, personId: jo.id }],
      });
      expect(response.status).toBe(200);
      const [row] = await test.db.select().from(participants).where(eq(participants.id, one.id));
      expect(row).toMatchObject({ displayName: 'Jo Parker', nameConfirmed: true, personId: jo.id });
      expect(sent).toEqual([]);
      expect((await check(meeting.id)).show).toBe(false);
    });

    it('queues the voice learning for the confirmed lines when learning is on', async () => {
      await settings.set('voices.remember', 'true');
      const jo = await known('Jo Parker', [1, 0, 0]);
      const meeting = await recording();
      const one = await voice(meeting.id, 'Speaker 1', [1, 0, 0]);
      const two = await voice(meeting.id, 'Speaker 2', [0, 0, 1]);
      await call('POST', `/meetings/${meeting.id}/check-people/confirm`, {
        voices: [{ participantId: one.id, personId: jo.id }],
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        name: 'meeting.learn-voice',
        payload: { meetingId: meeting.id, participantId: one.id },
      });
      expect((sent[0]?.payload as { segmentIds: string[] }).segmentIds).toHaveLength(3);
      // Speaker 2 was not confirmed: it keeps its label and nothing is learned from it.
      const [untouched] = await test.db
        .select()
        .from(participants)
        .where(eq(participants.id, two.id));
      expect(untouched).toMatchObject({ displayName: 'Speaker 2', nameConfirmed: false });
    });

    it('makes a new person with an email for a typed name', async () => {
      const meeting = await recording();
      const one = await voice(meeting.id, 'Speaker 1', null);
      await call('POST', `/meetings/${meeting.id}/check-people/confirm`, {
        voices: [{ participantId: one.id, name: ' Ann Lee ', email: 'Ann@Globex.example' }],
      });
      const [person] = await test.db.select().from(people).where(eq(people.name, 'Ann Lee'));
      expect(person?.emails).toEqual(['ann@globex.example']);
      const [row] = await test.db.select().from(participants).where(eq(participants.id, one.id));
      expect(row).toMatchObject({ displayName: 'Ann Lee', nameConfirmed: true });
    });

    it('does not learn for a person who is not tracked', async () => {
      await settings.set('voices.remember', 'true');
      const private_ = await known('Jo Parker', null, { tracking: 'off' });
      const meeting = await recording();
      const one = await voice(meeting.id, 'Speaker 1', [1, 0, 0]);
      await call('POST', `/meetings/${meeting.id}/check-people/confirm`, {
        voices: [{ participantId: one.id, personId: private_.id }],
      });
      expect(sent).toEqual([]);
    });

    it('refuses bad input, other meetings voices and the same person twice', async () => {
      const meeting = await recording();
      const other = await recording();
      const one = await voice(meeting.id, 'Speaker 1', null);
      const two = await voice(meeting.id, 'Speaker 2', null);
      const foreign = await voice(other.id, 'Speaker 1', null);
      const url = `/meetings/${meeting.id}/check-people/confirm`;
      expect((await call('POST', url, {})).status).toBe(400);
      expect((await call('POST', url, { voices: [] })).status).toBe(400);
      expect((await call('POST', url, { voices: [{ participantId: one.id }] })).status).toBe(400);
      expect(
        (await call('POST', url, { voices: [{ participantId: one.id, name: 'a\nb' }] })).status,
      ).toBe(400);
      expect(
        (await call('POST', url, { voices: [{ participantId: foreign.id, name: 'Jo Parker' }] }))
          .status,
      ).toBe(404);
      expect(
        (
          await call('POST', url, {
            voices: [
              { participantId: one.id, name: 'Jo Parker' },
              { participantId: two.id, name: 'jo parker' },
            ],
          })
        ).status,
      ).toBe(400);
      const rows = await test.db
        .select()
        .from(participants)
        .where(eq(participants.meetingId, meeting.id));
      expect(rows.every((r) => !r.nameConfirmed)).toBe(true);
    });
  });
});
