import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import {
  addVoiceSamples,
  ensurePerson,
  LocalStorage,
  SettingsStore,
  VOICE_TUNING_DEFAULTS,
  type JobName,
  type JobPayloads,
} from '@openminutes/core';
import {
  audioFiles,
  eq,
  meetings,
  participants,
  transcriptSegments,
  voiceReviews,
  voiceSamples,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { PeopleDto, PersonDetailDto, ReviewQueueDto, VoiceSettingsDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('voice readiness and environment cards', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let cookie = '';
  const sent: { name: JobName; payload: JobPayloads[JobName] }[] = [];

  beforeAll(async () => {
    test = await createTestDatabase();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-voice-cards-'))),
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

  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...json, cookie },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const queue = async (query = '') =>
    (await (await call('GET', `/people/review${query}`)).json()) as ReviewQueueDto;
  const detail = async (id: string) =>
    (await (await call('GET', `/people/${id}`)).json()) as PersonDetailDto;

  const angle = (degrees: number) => [
    Math.cos((degrees * Math.PI) / 180),
    Math.sin((degrees * Math.PI) / 180),
  ];

  async function meetingRow(title: string) {
    const [row] = await test.db
      .insert(meetings)
      .values({ title, platform: 'meet', joinUrl: '', status: 'transcribed', language: 'nl' })
      .returning();
    if (!row) throw new Error('insert failed');
    await test.db
      .insert(audioFiles)
      .values({ meetingId: row.id, path: 'x.opus', durationMs: 600_000, codec: 'opus', size: 1 });
    return row;
  }

  /** Jo Parker with `ways` ways of sounding over `ways` meetings of 24 s each. */
  async function profiled(name: string, ways: number) {
    const person = await ensurePerson(test.db, name);
    const samples = [];
    for (let i = 0; i < ways; i++) {
      const old = await meetingRow(`Earlier ${name} ${String(i)}`);
      samples.push({
        kind: 'line' as const,
        embedding: angle(i * 60),
        durationMs: 24_000,
        meetingId: old.id,
        language: 'nl',
      });
    }
    await addVoiceSamples(test.db, person.id, samples);
    return person;
  }

  /** A meeting where the person has `scores.length` confident 5 s lines with these voice scores. */
  async function lines(personId: string, name: string, scores: number[]) {
    const row = await meetingRow(`Meeting of ${name}`);
    const [seat, other] = await test.db
      .insert(participants)
      .values([
        { meetingId: row.id, displayName: name, personId, nameConfirmed: true },
        { meetingId: row.id, displayName: 'Ann' },
      ])
      .returning();
    if (!seat || !other) throw new Error('insert failed');
    const rows = await test.db
      .insert(transcriptSegments)
      .values(
        scores.map((score, i) => ({
          meetingId: row.id,
          participantId: seat.id,
          startMs: i * 60_000,
          endMs: i * 60_000 + 5000,
          text: `We should move the planning meeting to thursday, take ${String(i)}`,
          speakerConfidence: 0.95,
          speakerSource: 'indicator' as const,
          language: 'nl',
          voiceScores: [{ participantId: seat.id, score }],
        })),
      )
      .returning();
    return { meeting: row, seat, other, rows: rows.toSorted((a, b) => a.startMs - b.startMs) };
  }

  it('shows the Length and Variety bars of a profile', async () => {
    const person = await profiled('Jo Parker', 3);
    const [profile] = (await detail(person.id)).person.languages;
    expect(profile).toMatchObject({ language: 'nl', targetSeconds: 120 });
    expect(profile?.readiness.length).toBeCloseTo(72 / 120);
    expect(profile?.readiness).toMatchObject({
      meetings: { have: 3, target: 5 },
      ways: { have: 3, target: 5 },
      ready: false,
    });
    expect(profile?.readiness.variety).toBeCloseTo(3 / 5);
    const ready = await profiled('Sam Ready', 5);
    expect((await detail(ready.id)).person.languages[0]?.readiness).toMatchObject({
      length: 1,
      variety: 1,
      ready: true,
    });
  });

  it('asks a ready person only about lines the voice disagrees with', async () => {
    const jo = await profiled('Ready Jo', 5);
    const { rows } = await lines(jo.id, 'Ready Jo', [0.9, 0.2]);
    const body = await queue(`?personId=${jo.id}`);
    expect(body.lines.map((l) => l.id)).toEqual([rows[1]?.id]);
    expect(body.lines[0]).toMatchObject({ why: 'doubt', reason: 'voice', voiceScore: 0.2 });
    expect(body.complete.map((p) => p.id)).toEqual([jo.id]);
  });

  it('keeps asking a person who is not ready about lines the voice agrees with', async () => {
    const ann = await profiled('Unready Ann', 3);
    const { rows } = await lines(ann.id, 'Unready Ann', [0.9, 0.2]);
    const body = await queue(`?personId=${ann.id}`);
    expect(body.lines.map((l) => l.id).sort()).toEqual(rows.map((r) => r.id).sort());
    expect(body.lines.find((l) => l.id === rows[0]?.id)?.why).toBe('training');
  });

  describe('the environment card', () => {
    async function card(name: string) {
      const person = await profiled(name, 5);
      const { meeting, seat, rows } = await lines(person.id, name, [0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
      const [review] = await test.db
        .insert(voiceReviews)
        .values({
          meetingId: meeting.id,
          participantId: seat.id,
          personId: person.id,
          language: 'nl',
          mismatch: 0.9,
          sampleSegmentIds: rows.slice(0, 4).map((r) => r.id),
        })
        .returning();
      if (!review) throw new Error('insert failed');
      return { person, meeting, seat, rows, review };
    }

    it('ranks first in the queue, with lines to play, even for a ready person', async () => {
      const { person, review, rows } = await card('Card Jo');
      const body = await queue(`?personId=${person.id}`);
      expect(body.voices).toHaveLength(1);
      expect(body.voices[0]).toMatchObject({
        id: review.id,
        person: { id: person.id, name: 'Card Jo' },
        voiceName: 'Card Jo',
        language: 'nl',
        mismatch: 0.9,
        status: 'open',
      });
      expect(body.voices[0]?.lines.map((l) => l.id)).toEqual(rows.slice(0, 4).map((r) => r.id));
      expect(body.voices[0]?.lines.every((l) => l.hasAudio)).toBe(true);
      const page = (await (await call('GET', '/people')).json()) as PeopleDto;
      expect(page.needsReview).toBeGreaterThanOrEqual(1);
    });

    it('counts towards the session of 25', async () => {
      const { person } = await card('Count Jo');
      const body = await queue(`?personId=${person.id}`);
      expect(body.voices.length + body.lines.length).toBeLessThanOrEqual(25);
    });

    it('confirms the whole voice: the lines are verified and queued to become a way of sounding', async () => {
      const { person, review, rows, seat } = await card('Yes Jo');
      sent.length = 0;
      expect((await call('POST', `/people/review/voices/${review.id}/confirm`, {})).status).toBe(
        200,
      );
      const saved = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.participantId, seat.id));
      expect(saved.filter((s) => rows.slice(0, 4).some((r) => r.id === s.id))).toSatisfy(
        (list: typeof saved) => list.every((s) => s.speakerSource === 'user'),
      );
      expect(saved.every((s) => !s.voiceDoubt)).toBe(true);
      // Learning is off by default, so nothing is queued until the setting is on.
      expect(sent).toEqual([]);
      const [done] = await test.db
        .select()
        .from(voiceReviews)
        .where(eq(voiceReviews.id, review.id));
      expect(done).toMatchObject({ status: 'confirmed', decidedPersonId: person.id });
      expect((await queue(`?personId=${person.id}`)).voices).toEqual([]);
      expect((await call('POST', `/people/review/voices/${review.id}/confirm`, {})).status).toBe(
        409,
      );
    });

    it('queues the learning of the lines once voices may be learned', async () => {
      const { review, person, meeting } = await card('Learn Jo');
      await call('PUT', '/settings/voices', { remember: true });
      sent.length = 0;
      await call('POST', `/people/review/voices/${review.id}/confirm`, {});
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        name: 'meeting.learn-voice',
        payload: { meetingId: meeting.id },
      });
      expect(person.id).toBeTruthy();
      await call('PUT', '/settings/voices', { remember: false });
    });

    it('moves the whole voice to the person the owner picks and keeps it out of the profile', async () => {
      const { person, review, rows, meeting } = await card('No Jo');
      const sam = await ensurePerson(test.db, 'Sam Else');
      const before = await test.db
        .select()
        .from(voiceSamples)
        .where(eq(voiceSamples.personId, person.id));
      expect((await call('POST', `/people/review/voices/${review.id}/move`, {})).status).toBe(400);
      expect(
        (await call('POST', `/people/review/voices/${review.id}/move`, { personId: person.id }))
          .status,
      ).toBe(400);
      expect(
        (await call('POST', `/people/review/voices/${review.id}/move`, { personId: sam.id }))
          .status,
      ).toBe(200);
      const seats = await test.db
        .select()
        .from(participants)
        .where(eq(participants.meetingId, meeting.id));
      const samSeat = seats.find((s) => s.personId === sam.id);
      expect(samSeat).toBeDefined();
      const saved = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.meetingId, meeting.id));
      for (const row of rows) {
        expect(saved.find((s) => s.id === row.id)).toMatchObject({
          participantId: samSeat?.id,
          speakerSource: 'user',
        });
      }
      const after = await test.db
        .select()
        .from(voiceSamples)
        .where(eq(voiceSamples.personId, person.id));
      expect(after).toHaveLength(before.length);
      const [done] = await test.db
        .select()
        .from(voiceReviews)
        .where(eq(voiceReviews.id, review.id));
      expect(done).toMatchObject({ status: 'moved', decidedPersonId: sam.id });
    });

    it('remembers a skip, lists it with the skipped cards and takes it back', async () => {
      const { person, review } = await card('Skip Jo');
      expect((await call('POST', `/people/review/voices/${review.id}/skip`, {})).status).toBe(200);
      const hidden = await queue(`?personId=${person.id}`);
      expect(hidden.voices).toEqual([]);
      expect(hidden.skippedCount).toBeGreaterThanOrEqual(1);
      const skipped = await queue(`?personId=${person.id}&skipped=1`);
      expect(skipped.voices.map((v) => [v.id, v.status])).toEqual([[review.id, 'skipped']]);
      expect((await call('POST', `/people/review/voices/${review.id}/reopen`, {})).status).toBe(
        200,
      );
      expect((await queue(`?personId=${person.id}`)).voices.map((v) => v.id)).toEqual([review.id]);
    });

    it('does not offer a card of a person who is not tracked', async () => {
      const { person } = await card('Off Jo');
      await call('POST', `/people/${person.id}/tracking`, { tracking: 'off' });
      expect((await queue(`?personId=${person.id}`)).voices).toEqual([]);
    });
  });

  describe('the voice settings', () => {
    it('returns the readiness and matching numbers with their defaults', async () => {
      const body = (await (await call('GET', '/settings/voices')).json()) as VoiceSettingsDto;
      expect(body.tuning).toEqual(VOICE_TUNING_DEFAULTS);
      expect(body.tuningDefaults).toEqual(VOICE_TUNING_DEFAULTS);
    });

    it('saves them, refuses numbers out of range and changes the bars', async () => {
      expect((await call('PUT', '/settings/voices', { readySeconds: 5 })).status).toBe(400);
      expect((await call('PUT', '/settings/voices', { agreeScore: 'high' })).status).toBe(400);
      const saved = await call('PUT', '/settings/voices', {
        readySeconds: 60,
        mergeSimilarity: 0.5,
      });
      expect(((await saved.json()) as VoiceSettingsDto).tuning).toMatchObject({
        readySeconds: 60,
        mergeSimilarity: 0.5,
        readyMeetings: 5,
      });
      const person = await profiled('Short Jo', 3);
      expect((await detail(person.id)).person.languages[0]).toMatchObject({ targetSeconds: 60 });
      await call('PUT', '/settings/voices', VOICE_TUNING_DEFAULTS);
    });
  });
});
