import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import {
  addVoiceSamples,
  LocalStorage,
  SettingsStore,
  type JobName,
  type JobPayloads,
} from '@openminutes/core';
import {
  audioFiles,
  eq,
  meetings,
  notInArray,
  participants,
  people,
  transcriptSegments,
  voiceSamples,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { PeopleDto, PersonDetailDto, ReviewQueueDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const missing = '00000000-0000-4000-8000-000000000000';

describe('people', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  let app: Hono;
  let cookie = '';
  const sent: { name: JobName; payload: JobPayloads[JobName] }[] = [];

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, secret);
    app = createApp({
      db: test.db,
      settings,
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-people-'))),
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
  const detail = async (id: string) =>
    (await (await call('GET', `/people/${id}`)).json()) as PersonDetailDto;
  const create = async (body: object) => {
    const response = await call('POST', '/people', body);
    expect(response.status).toBe(201);
    return ((await response.json()) as PersonDetailDto).person;
  };

  /** A synthetic meeting where one voice, labelled Speaker 1, said three lines. */
  async function meeting(title = 'Weekly') {
    const [row] = await test.db
      .insert(meetings)
      .values({ title, platform: 'recording', joinUrl: '', status: 'transcribed' })
      .returning();
    if (!row) throw new Error('insert failed');
    const [one, two] = await test.db
      .insert(participants)
      .values([
        { meetingId: row.id, displayName: 'Speaker 1' },
        { meetingId: row.id, displayName: 'Speaker 2' },
      ])
      .returning();
    if (!one || !two) throw new Error('insert failed');
    const line = (i: number, participantId: string, extra: object = {}) => ({
      meetingId: row.id,
      participantId,
      startMs: i * 4000,
      endMs: i * 4000 + 3000,
      text: `Synthetic line ${String(i)} about the quarterly planning`,
      speakerConfidence: 0.4,
      speakerSource: 'diarization' as const,
      speakerCandidates: [
        { participantId, score: 0.6 },
        { participantId: participantId === one.id ? two.id : one.id, score: 0.4 },
      ],
      ...extra,
    });
    const lines = await test.db
      .insert(transcriptSegments)
      .values([line(0, one.id), line(1, one.id), line(2, two.id, { speakerConfidence: 0.95 })])
      .returning();
    const [a, b, c] = lines.toSorted((x, y) => x.startMs - y.startMs);
    if (!a || !b || !c) throw new Error('insert failed');
    return { meeting: row, one, two, a, b, c };
  }

  describe('the list', () => {
    it('needs a session', async () => {
      expect((await app.request('/api/people')).status).toBe(401);
      expect((await app.request('/api/people/' + missing)).status).toBe(401);
    });

    it('creates people with no, one or several emails, in lower case without doubles', async () => {
      const none = await create({ name: 'No Mail' });
      const several = await create({
        name: 'Many Mails',
        emails: [' Many@Example.com ', 'many@example.com', 'other@example.com'],
        notes: 'Synthetic note',
      });
      expect(none.emails).toEqual([]);
      expect(several).toMatchObject({
        emails: ['many@example.com', 'other@example.com'],
        notes: 'Synthetic note',
      });
      const list = (await (await call('GET', '/people')).json()) as PeopleDto;
      expect(list.learning).toBe(false);
      expect(list.checking).toBe(false);
      expect(list.people.map((p) => p.name)).toEqual(
        expect.arrayContaining(['No Mail', 'Many Mails']),
      );
    });

    it('refuses a second person with the same name or email, and bad input', async () => {
      await create({ name: 'Dup Name', emails: ['dup@example.com'] });
      expect((await call('POST', '/people', { name: 'dup name' })).status).toBe(409);
      expect(
        (await call('POST', '/people', { name: 'Other', emails: ['DUP@example.com'] })).status,
      ).toBe(409);
      expect((await call('POST', '/people', { name: '' })).status).toBe(400);
      expect((await call('POST', '/people', { name: 'X', emails: ['nope'] })).status).toBe(400);
      expect((await call('POST', '/people', { name: 'X', extra: 1 })).status).toBe(400);
    });

    it('edits name, emails and notes, and renames the labels of their lines', async () => {
      const { meeting: m, one } = await meeting();
      const person = await create({ name: 'Before Name' });
      await test.db
        .update(participants)
        .set({ displayName: 'Before Name', personId: person.id })
        .where(eq(participants.id, one.id));
      const response = await call('PATCH', `/people/${person.id}`, {
        name: 'After Name',
        emails: ['after@example.com'],
        notes: null,
      });
      expect(response.status).toBe(200);
      expect(((await response.json()) as PersonDetailDto).person).toMatchObject({
        name: 'After Name',
        emails: ['after@example.com'],
      });
      const [label] = await test.db.select().from(participants).where(eq(participants.id, one.id));
      expect(label?.displayName).toBe('After Name');
      expect(m.id).toBe(label?.meetingId);
      expect((await call('PATCH', `/people/${person.id}`, {})).status).toBe(400);
      expect((await call('PATCH', `/people/${missing}`, { name: 'Z' })).status).toBe(404);
    });
  });

  describe('merging and deleting', () => {
    it('folds one person into another with emails, samples and meetings', async () => {
      const keep = await create({ name: 'Keep Me', emails: ['keep@example.com'], notes: 'one' });
      const fold = await create({ name: 'Fold Me', emails: ['fold@example.com'], notes: 'two' });
      await addVoiceSamples(test.db, keep.id, [{ kind: 'imported', embedding: [1, 0] }]);
      await addVoiceSamples(test.db, fold.id, [{ kind: 'imported', embedding: [0, 1] }]);
      const { one } = await meeting();
      await test.db
        .update(participants)
        .set({ displayName: 'Fold Me', personId: fold.id })
        .where(eq(participants.id, one.id));

      const response = await call('POST', `/people/${keep.id}/merge`, { sourceId: fold.id });
      expect(response.status).toBe(200);
      const merged = (await response.json()) as PersonDetailDto;
      expect(merged.person).toMatchObject({
        emails: ['keep@example.com', 'fold@example.com'],
        notes: 'one\n\ntwo',
        samples: 2,
      });
      expect(merged.prototypes).toBe(2);
      expect(await test.db.select().from(people).where(eq(people.id, fold.id))).toEqual([]);
      const [label] = await test.db.select().from(participants).where(eq(participants.id, one.id));
      expect(label).toMatchObject({ personId: keep.id, displayName: 'Keep Me' });
      expect((await call('POST', `/people/${keep.id}/merge`, { sourceId: keep.id })).status).toBe(
        400,
      );
      expect((await call('POST', `/people/${keep.id}/merge`, { sourceId: missing })).status).toBe(
        404,
      );
    });

    it('deletes a person but keeps the labels in the meetings', async () => {
      const person = await create({ name: 'Gone Soon' });
      const { one } = await meeting();
      await test.db
        .update(participants)
        .set({ displayName: 'Gone Soon', personId: person.id })
        .where(eq(participants.id, one.id));
      expect((await call('DELETE', `/people/${person.id}`)).status).toBe(200);
      const [label] = await test.db.select().from(participants).where(eq(participants.id, one.id));
      expect(label).toMatchObject({ displayName: 'Gone Soon', personId: null });
      expect((await call('DELETE', `/people/${person.id}`)).status).toBe(404);
    });
  });

  describe('voice lines', () => {
    async function anna() {
      const person = await create({ name: `Anna ${String(Math.random()).slice(2, 8)}` });
      const fixture = await meeting();
      await test.db
        .update(participants)
        .set({ displayName: person.name, personId: person.id, nameConfirmed: true })
        .where(eq(participants.id, fixture.one.id));
      return { person, ...fixture };
    }

    it('lists uncertain lines for review and the verified ones apart', async () => {
      const { person, a, b, c } = await anna();
      await test.db
        .update(transcriptSegments)
        .set({ speakerSource: 'user' })
        .where(eq(transcriptSegments.id, c.id));
      await test.db
        .update(transcriptSegments)
        .set({ speakerSource: 'user', participantId: a.participantId })
        .where(eq(transcriptSegments.id, a.id));
      const body = await detail(person.id);
      expect(body.verified.map((l) => l.id)).toEqual([a.id]);
      expect(body.review.map((l) => l.id)).toEqual([b.id]);
      expect(body.review[0]).toMatchObject({
        reason: 'uncertain',
        verified: false,
        meetingTitle: 'Weekly',
      });
      expect(body.person.needsReview).toBe(1);
    });

    it('lists a line suggested for this person', async () => {
      const { person, two, c } = await anna();
      await test.db
        .update(participants)
        .set({ displayName: `${person.name} Two` })
        .where(eq(participants.id, two.id));
      const speaker = await test.db
        .select()
        .from(participants)
        .where(eq(participants.personId, person.id));
      await test.db
        .update(transcriptSegments)
        .set({ suggestedParticipantId: speaker[0]?.id ?? null })
        .where(eq(transcriptSegments.id, c.id));
      const body = await detail(person.id);
      expect(body.review.map((l) => [l.id, l.reason])).toContainEqual([c.id, 'suggested']);
    });

    it('verifies a line as a user edit and only queues learning when it is on', async () => {
      const { person, meeting: m, one, b } = await anna();
      sent.length = 0;
      const off = await call('POST', `/people/${person.id}/lines/${b.id}/verify`, {});
      expect(off.status).toBe(200);
      expect(sent).toEqual([]);
      const [row] = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.id, b.id));
      expect(row).toMatchObject({ speakerSource: 'user', participantId: one.id });
      expect((await detail(person.id)).verified.map((l) => l.id)).toContain(b.id);

      await settings.set('voices.remember', 'true');
      const on = await call('POST', `/people/${person.id}/lines/${b.id}/verify`, {});
      expect(on.status).toBe(200);
      expect(sent).toEqual([
        {
          name: 'meeting.learn-voice',
          payload: { meetingId: m.id, participantId: one.id, segmentIds: [b.id] },
        },
      ]);
      await settings.set('voices.remember', 'false');
    });

    it('verifying a line of someone else moves it and creates the speaker for the meeting', async () => {
      const { person, meeting: m, c, two } = await anna();
      await call('POST', `/people/${person.id}/lines/${c.id}/verify`, {});
      const [row] = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.id, c.id));
      expect(row?.participantId).not.toBe(two.id);
      expect(row).toMatchObject({ speakerSource: 'user', previousParticipantId: two.id });
      const speakers = await test.db
        .select()
        .from(participants)
        .where(eq(participants.meetingId, m.id));
      expect(speakers.find((p) => p.id === row?.participantId)?.personId).toBe(person.id);
    });

    it('refuses a line or person that does not exist', async () => {
      const { person } = await anna();
      expect((await call('POST', `/people/${person.id}/lines/${missing}/verify`, {})).status).toBe(
        404,
      );
      expect((await call('POST', `/people/${missing}/lines/${missing}/verify`, {})).status).toBe(
        404,
      );
      expect((await call('POST', `/people/${person.id}/lines/nope/verify`, {})).status).toBe(404);
    });

    it('rejects a line: it goes to the next best speaker and is not offered again', async () => {
      const { person, two, b } = await anna();
      await addVoiceSamples(test.db, person.id, [
        { kind: 'line', embedding: [1, 0], segmentId: b.id, durationMs: 3000 },
      ]);
      expect((await detail(person.id)).person.samples).toBe(1);
      const response = await call('POST', `/people/${person.id}/lines/${b.id}/reject`, {});
      expect(response.status).toBe(200);
      const body = (await response.json()) as PersonDetailDto;
      expect(body.review.map((l) => l.id)).not.toContain(b.id);
      expect(body.person.samples).toBe(0);
      const [row] = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.id, b.id));
      expect(row).toMatchObject({ participantId: two.id, speakerSource: 'guess' });
    });

    it('rejecting a suggestion remembers it on the line', async () => {
      const { person, one, c } = await anna();
      await test.db
        .update(transcriptSegments)
        .set({ suggestedParticipantId: one.id })
        .where(eq(transcriptSegments.id, c.id));
      await call('POST', `/people/${person.id}/lines/${c.id}/reject`, {});
      const [row] = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.id, c.id));
      expect(row).toMatchObject({ suggestedParticipantId: null, rejectedSuggestions: [one.id] });
    });

    it('refuses to reject a line when nobody else fits', async () => {
      const { person, b } = await anna();
      await test.db
        .update(transcriptSegments)
        .set({ speakerCandidates: null })
        .where(eq(transcriptSegments.id, b.id));
      const response = await call('POST', `/people/${person.id}/lines/${b.id}/reject`, {});
      expect(response.status).toBe(409);
    });

    it('moves a line to another person and takes it out of the first profile', async () => {
      const { person, b } = await anna();
      const bram = await create({ name: `Bram ${String(Math.random()).slice(2, 8)}` });
      await addVoiceSamples(test.db, person.id, [
        { kind: 'line', embedding: [1, 0], segmentId: b.id, durationMs: 3000 },
      ]);
      const response = await call('POST', `/people/${person.id}/lines/${b.id}/move`, {
        personId: bram.id,
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as PersonDetailDto;
      expect(body.person.samples).toBe(0);
      expect(body.review.map((l) => l.id)).not.toContain(b.id);
      expect((await detail(bram.id)).verified.map((l) => l.id)).toEqual([b.id]);
      expect(
        await test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, person.id)),
      ).toEqual([]);
      expect((await call('POST', `/people/${person.id}/lines/${b.id}/move`, {})).status).toBe(400);
    });

    it('removes a sample from the profile and builds it again', async () => {
      const { person, a, b } = await anna();
      await addVoiceSamples(test.db, person.id, [
        { kind: 'line', embedding: [1, 0], segmentId: a.id, durationMs: 3000 },
        { kind: 'line', embedding: [0, 1], segmentId: b.id, durationMs: 3000 },
      ]);
      expect((await detail(person.id)).prototypes).toBe(2);
      const response = await call('DELETE', `/people/${person.id}/lines/${b.id}/profile`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as PersonDetailDto;
      expect(body).toMatchObject({ prototypes: 1, person: { samples: 1, voiceSeconds: 3 } });
      expect((await call('DELETE', `/people/${person.id}/lines/${b.id}/profile`)).status).toBe(404);
    });

    it('forgets the voice of one person and keeps the person', async () => {
      const { person, a } = await anna();
      await addVoiceSamples(test.db, person.id, [
        { kind: 'line', embedding: [1, 0], segmentId: a.id, durationMs: 3000 },
      ]);
      const response = await call('DELETE', `/people/${person.id}/voice`);
      const body = (await response.json()) as PersonDetailDto;
      expect(body).toMatchObject({ prototypes: 0, person: { name: person.name, samples: 0 } });
    });

    it('takes a line out of a profile when it is assigned to someone else in the transcript', async () => {
      const { person, meeting: m, a, two } = await anna();
      await addVoiceSamples(test.db, person.id, [
        { kind: 'line', embedding: [1, 0], segmentId: a.id, durationMs: 3000 },
      ]);
      const response = await call('POST', `/meetings/${m.id}/speaker-edits`, {
        kind: 'assign',
        segmentIds: [a.id],
        speaker: { id: two.id },
      });
      expect(response.status).toBe(200);
      expect((await detail(person.id)).person.samples).toBe(0);
    });
  });
  describe('the review queue', () => {
    const queue = async (query = '') =>
      (await (await call('GET', `/people/review${query}`)).json()) as ReviewQueueDto;

    async function room() {
      const person = await create({ name: `Queue ${String(Math.random()).slice(2, 8)}` });
      const carl = await create({ name: `Carl ${String(Math.random()).slice(2, 8)}` });
      const fixture = await meeting('Queue meeting');
      await test.db
        .update(participants)
        .set({ displayName: person.name, personId: person.id, nameConfirmed: true })
        .where(eq(participants.id, fixture.one.id));
      await test.db.insert(participants).values([
        { meetingId: fixture.meeting.id, displayName: carl.name, personId: carl.id },
        { meetingId: fixture.meeting.id, displayName: 'Notetaker', isBot: true },
        { meetingId: fixture.meeting.id, displayName: 'Dana Named', nameConfirmed: true },
      ]);
      await test.db
        .update(transcriptSegments)
        .set({ speakerConfidence: 0.2 })
        .where(eq(transcriptSegments.id, fixture.a.id));
      await test.db
        .update(transcriptSegments)
        .set({ speakerConfidence: 0.5 })
        .where(eq(transcriptSegments.id, fixture.b.id));
      return { person, carl, ...fixture };
    }

    it('needs a session and a valid person', async () => {
      expect((await app.request('/api/people/review')).status).toBe(401);
      expect((await call('GET', '/people/review?personId=nope')).status).toBe(404);
    });

    it('lists the least certain line first with the proposal and what was considered', async () => {
      const { person, a, b } = await room();
      const body = await queue(`?personId=${person.id}`);
      expect(body.lines.map((l) => l.id)).toEqual([a.id, b.id]);
      expect(body.lines[0]).toMatchObject({
        meetingTitle: 'Queue meeting',
        speakerConfidence: 0.2,
        reason: 'uncertain',
        proposed: { id: person.id, name: person.name },
        considered: [{ name: 'Speaker 2', score: 0.4 }],
      });
      expect(Date.parse(body.lines[0]?.meetingDate ?? '')).not.toBeNaN();
      expect(body.people.map((p) => p.id)).toContain(person.id);
    });

    it('offers only the other people of the meeting, without bots, the proposal and placeholders', async () => {
      const { person, carl } = await room();
      const [line] = (await queue(`?personId=${person.id}`)).lines;
      const names = line?.roster.map((r) => r.name) ?? [];
      expect(names).toEqual([carl.name, 'Dana Named'].sort((x, y) => x.localeCompare(y)));
      expect(line?.roster.find((r) => r.name === carl.name)?.personId).toBe(carl.id);
      expect(line?.roster.find((r) => r.name === 'Dana Named')?.personId).toBeNull();
      expect(names).not.toContain('Notetaker');
      expect(names).not.toContain(person.name);
      expect(names).not.toContain('Speaker 2');
    });

    it('drops lines once they are verified and covers every person without a filter', async () => {
      const { person, a, b } = await room();
      expect((await call('POST', `/people/${person.id}/lines/${a.id}/verify`, {})).status).toBe(
        200,
      );
      const scoped = await queue(`?personId=${person.id}`);
      expect(scoped.lines.map((l) => l.id)).toEqual([b.id]);
      expect((await queue()).lines.map((l) => l.id)).toContain(b.id);
    });
  });

  describe('skips and stored decisions', () => {
    const queue = async (query = '') =>
      (await (await call('GET', `/people/review${query}`)).json()) as ReviewQueueDto;

    async function room() {
      const person = await create({ name: `Skip ${String(Math.random()).slice(2, 8)}` });
      const other = await create({ name: `Else ${String(Math.random()).slice(2, 8)}` });
      const fixture = await meeting('Skip meeting');
      await test.db
        .update(participants)
        .set({ displayName: person.name, personId: person.id, nameConfirmed: true })
        .where(eq(participants.id, fixture.one.id));
      return { person, other, ...fixture };
    }
    const ids = (body: ReviewQueueDto) => body.lines.map((l) => l.id);

    it('keeps a skipped line out of the queue in a later session and lists it on request', async () => {
      const { person, a, b } = await room();
      const skip = await call('POST', '/people/review/skip', {
        personId: person.id,
        segmentId: a.id,
      });
      expect(skip.status).toBe(200);
      const again = await queue(`?personId=${person.id}`);
      expect(ids(again)).toEqual([b.id]);
      expect(again.skippedCount).toBe(1);
      const skipped = await queue(`?personId=${person.id}&skipped=1`);
      expect(ids(skipped)).toEqual([a.id]);
    });

    it('brings a skipped line back when it is proposed for someone else', async () => {
      const { person, other, a } = await room();
      await call('POST', '/people/review/skip', { personId: person.id, segmentId: a.id });
      await test.db
        .update(participants)
        .set({ personId: other.id })
        .where(eq(participants.id, a.participantId ?? ''));
      expect(ids(await queue(`?personId=${other.id}`))).toContain(a.id);
    });

    it('undoes a skip', async () => {
      const { person, a } = await room();
      await call('POST', '/people/review/skip', { personId: person.id, segmentId: a.id });
      const undone = await call('POST', '/people/review/undo', { segmentId: a.id });
      expect(await undone.json()).toEqual({ undone: 'skip' });
      expect(ids(await queue(`?personId=${person.id}`))).toContain(a.id);
      const nothing = await call('POST', '/people/review/undo', { segmentId: a.id });
      expect(await nothing.json()).toEqual({ undone: null });
    });

    it('rejects a skip for a missing line or person', async () => {
      const { person, a } = await room();
      expect(
        (await call('POST', '/people/review/skip', { personId: missing, segmentId: a.id })).status,
      ).toBe(404);
      expect(
        (await call('POST', '/people/review/skip', { personId: person.id, segmentId: missing }))
          .status,
      ).toBe(404);
      expect((await call('POST', '/people/review/skip', { nope: 1 })).status).toBe(404);
    });

    it('undoes a verify: the old label and the profile come back', async () => {
      const { person, a, one, two } = await room();
      await test.db
        .update(transcriptSegments)
        .set({ participantId: two.id })
        .where(eq(transcriptSegments.id, a.id));
      await call('POST', `/people/${person.id}/lines/${a.id}/verify`, {});
      await test.db.insert(voiceSamples).values({
        personId: person.id,
        kind: 'line',
        segmentId: a.id,
        embedding: [1, 0],
        durationMs: 3000,
      });
      const [verified] = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.id, a.id));
      expect(verified).toMatchObject({ participantId: one.id, speakerSource: 'user' });
      expect((await call('POST', '/people/review/undo', { segmentId: a.id })).status).toBe(200);
      const [back] = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.id, a.id));
      expect(back).toMatchObject({ participantId: two.id, speakerSource: 'diarization' });
      const samples = await test.db
        .select()
        .from(voiceSamples)
        .where(eq(voiceSamples.segmentId, a.id));
      expect(samples).toEqual([]);
      expect(ids(await queue(`?personId=${person.id}`))).not.toContain(a.id);
    });

    it('undoes a rejection so the line is offered again', async () => {
      const { person, a } = await room();
      const rejected = await call('POST', `/people/${person.id}/lines/${a.id}/reject`, {});
      expect(rejected.status).toBe(200);
      expect(ids(await queue(`?personId=${person.id}`))).not.toContain(a.id);
      const undone = await call('POST', '/people/review/undo', { segmentId: a.id });
      expect(await undone.json()).toEqual({ undone: 'reject' });
      expect(ids(await queue(`?personId=${person.id}`))).toContain(a.id);
    });
  });

  describe('the useful queue', () => {
    const queue = async (query = '') =>
      (await (await call('GET', `/people/review${query}`)).json()) as ReviewQueueDto;
    const ids = (body: ReviewQueueDto) => body.lines.map((l) => l.id);

    /** One meeting with the given lines of one person, each `ms` long and spaced a minute apart. */
    async function lines(
      specs: { ms?: number; text?: string; other?: boolean; rival?: number; sure?: boolean }[],
    ) {
      const person = await create({ name: `Useful ${String(Math.random()).slice(2, 8)}` });
      const fixture = await meeting('Useful meeting');
      await test.db
        .update(participants)
        .set({ displayName: person.name, personId: person.id, nameConfirmed: true })
        .where(eq(participants.id, fixture.one.id));
      await test.db.insert(audioFiles).values({
        meetingId: fixture.meeting.id,
        path: 'x.opus',
        durationMs: 600_000,
        codec: 'opus',
        size: 1,
      });
      await test.db
        .delete(transcriptSegments)
        .where(eq(transcriptSegments.meetingId, fixture.meeting.id));
      const rows = await test.db
        .insert(transcriptSegments)
        .values(
          specs.flatMap((spec, i) => {
            const start = i * 60_000;
            const base = {
              meetingId: fixture.meeting.id,
              participantId: fixture.one.id,
              startMs: start,
              endMs: start + (spec.ms ?? 5000),
              text: spec.text ?? 'we should move the planning meeting to thursday',
              speakerConfidence: spec.sure ? 0.95 : 0.3,
              speakerSource: 'diarization' as const,
              speakerCandidates: [
                { participantId: fixture.one.id, score: spec.sure ? 0.95 : 0.3 },
                { participantId: fixture.two.id, score: spec.rival ?? 0.1 },
              ],
            };
            return [
              base,
              ...(spec.other
                ? [
                    {
                      ...base,
                      participantId: fixture.two.id,
                      startMs: start + 1000,
                      endMs: start + 4000,
                      speakerConfidence: 0.99,
                    },
                  ]
                : []),
            ];
          }),
        )
        .returning();
      const mine = rows.filter((r) => r.participantId === fixture.one.id);
      return { person, fixture, mine: mine.toSorted((x, y) => x.startMs - y.startMs) };
    }

    it('leaves out short lines, overlapped lines and filler', async () => {
      const { person, mine } = await lines([
        {},
        { ms: 2000 },
        { other: true },
        { text: 'yeah okay right' },
      ]);
      const body = await queue(`?personId=${person.id}`);
      expect(ids(body)).toEqual([mine[0]?.id]);
    });

    it('stops asking for training at 90 seconds, shows who is good enough, keeps doubtful lines', async () => {
      const { person, mine } = await lines([{ rival: 0.8 }, { sure: true }, { sure: true }]);
      await test.db.insert(voiceSamples).values({
        personId: person.id,
        kind: 'imported',
        embedding: [1, 0],
        durationMs: 90_000,
      });
      const body = await queue(`?personId=${person.id}`);
      expect(ids(body)).toEqual([mine[0]?.id]);
      expect(body.lines[0]).toMatchObject({ profileSeconds: 90, profileTargetSeconds: 90 });
      expect(body.complete.map((p) => p.id)).toEqual([person.id]);
    });

    it('shows how far the profile is', async () => {
      const { person } = await lines([{ sure: true }]);
      await test.db.insert(voiceSamples).values({
        personId: person.id,
        kind: 'imported',
        embedding: [1, 0],
        durationMs: 45_000,
      });
      const body = await queue(`?personId=${person.id}`);
      expect(body.lines[0]).toMatchObject({
        profileSeconds: 45,
        profileTargetSeconds: 90,
        why: 'training',
      });
      expect(body.complete).toEqual([]);
    });

    it('caps a session at 25 cards and says how many more there are', async () => {
      const second = await lines(Array.from({ length: 40 }, () => ({ ms: 3000 })));
      const capped = await queue(`?personId=${second.person.id}`);
      expect(capped.lines).toHaveLength(25);
      // Doubtful lines are all asked about, the session shows the first 25.
      expect(capped.more).toBe(15);
      expect(capped.lines.every((l) => l.why === 'doubt')).toBe(true);
      const training = await lines(Array.from({ length: 40 }, () => ({ ms: 3000, sure: true })));
      const trained = await queue(`?personId=${training.person.id}`);
      // Confident 3 s lines stop at the 90 s target: 30 of the 40, 25 of them in this session.
      expect(trained.lines).toHaveLength(25);
      expect(trained.more).toBe(5);
    });

    describe('the number of lines to review', () => {
      /** What every place shows for a person: page, list column, and the queue behind them. */
      async function counts(personId: string, name: string) {
        const page = (await (
          await call('GET', `/people?q=${encodeURIComponent(name)}`)
        ).json()) as PeopleDto;
        const column = page.people.find((p) => p.id === personId)?.needsReview;
        const queued = await queue(`?personId=${personId}`);
        return {
          column,
          header: (await detail(personId)).person.needsReview,
          queue: queued.lines.length + queued.more,
        };
      }

      it('asks only for the lines a thin profile still needs, not every unverified line', async () => {
        const { person } = await lines(
          Array.from({ length: 200 }, () => ({ ms: 6000, sure: true })),
        );
        // 90 s target at 6 s a line is 15 lines, however many confident lines there are.
        expect(await counts(person.id, person.name)).toEqual({ column: 15, header: 15, queue: 15 });
      });

      it('counts only the doubtful lines of a well-profiled person', async () => {
        const { person } = await lines([
          ...Array.from({ length: 3 }, () => ({ ms: 5000 })),
          ...Array.from({ length: 30 }, () => ({ ms: 5000, sure: true })),
        ]);
        await test.db.insert(voiceSamples).values({
          personId: person.id,
          kind: 'imported',
          embedding: [1, 0],
          durationMs: 120_000,
        });
        expect(await counts(person.id, person.name)).toEqual({ column: 3, header: 3, queue: 3 });
      });

      it('never counts short, overlapped or filler lines', async () => {
        const { person } = await lines([
          { ms: 2000 },
          { other: true },
          { text: 'yeah okay right' },
          { ms: 2000, sure: true },
          { text: 'uh yeah no sure thanks', sure: true },
          {},
        ]);
        // Only the last, plain doubtful line is worth a look.
        expect(await counts(person.id, person.name)).toEqual({ column: 1, header: 1, queue: 1 });
      });

      it('adds up to the People page total, capped to a session for the button', async () => {
        const { person } = await lines(
          Array.from({ length: 200 }, () => ({ ms: 3000, sure: true })),
        );
        const page = (await (await call('GET', '/people')).json()) as PeopleDto;
        const sum = (await counts(person.id, person.name)).column ?? 0;
        expect(sum).toBe(30);
        expect(page.needsReview).toBeGreaterThanOrEqual(sum);
        expect(page.reviewable).toBe(Math.min(page.needsReview, 25));
      });
    });

    it('counts the useful lines on the People page, capped', async () => {
      const response = await call('GET', '/people');
      const page = (await response.json()) as PeopleDto;
      expect(page.reviewable).toBeLessThanOrEqual(25);
      expect(page.reviewable).toBeGreaterThan(0);
    });
  });

  describe('voice profiles per language', () => {
    const queue = async (query = '') =>
      (await (await call('GET', `/people/review${query}`)).json()) as ReviewQueueDto;

    /** One person with two meetings of 6 confident lines each, one in Dutch and one in English. */
    async function bilingual() {
      const person = await create({ name: `Bilingual ${String(Math.random()).slice(2, 8)}` });
      const make = async (language: string) => {
        const fixture = await meeting(`Meeting ${language}`);
        await test.db.update(meetings).set({ language }).where(eq(meetings.id, fixture.meeting.id));
        await test.db
          .update(participants)
          .set({ displayName: person.name, personId: person.id, nameConfirmed: true })
          .where(eq(participants.id, fixture.one.id));
        await test.db.insert(audioFiles).values({
          meetingId: fixture.meeting.id,
          path: 'x.opus',
          durationMs: 600_000,
          codec: 'opus',
          size: 1,
        });
        await test.db
          .update(transcriptSegments)
          .set({ speakerConfidence: 0.95, language })
          .where(eq(transcriptSegments.meetingId, fixture.meeting.id));
        return fixture;
      };
      const dutch = await make('nl');
      const english = await make('en');
      return { person, dutch, english };
    }

    it('counts coverage per language: a finished Dutch profile does not stop English training', async () => {
      const { person, dutch, english } = await bilingual();
      await test.db.insert(voiceSamples).values({
        personId: person.id,
        kind: 'imported',
        embedding: [1, 0],
        durationMs: 90_000,
        language: 'nl',
      });
      const body = await queue(`?personId=${person.id}`);
      const ids = body.lines.map((l) => l.id);
      expect(ids).toContain(english.a.id);
      expect(ids).not.toContain(dutch.a.id);
      const card = body.lines.find((l) => l.id === english.a.id);
      expect(card).toMatchObject({ language: 'en', languageName: 'English', profileSeconds: 0 });
      expect(body.complete).toEqual([
        expect.objectContaining({ id: person.id, language: 'nl', languageName: 'Dutch' }),
      ]);
    });

    it('lists a person with one profile per language and creates one from a verified line', async () => {
      const { person, dutch, english } = await bilingual();
      await test.db.insert(voiceSamples).values([
        {
          personId: person.id,
          kind: 'imported',
          embedding: [1, 0],
          durationMs: 30_000,
          language: 'nl',
        },
        {
          personId: person.id,
          kind: 'imported',
          embedding: [0, 1],
          durationMs: 12_000,
          language: 'en',
        },
      ]);
      const listed = (await (await call('GET', '/people')).json()) as PeopleDto;
      const row = listed.people.find((p) => p.id === person.id);
      expect(row?.languages.map((l) => [l.language, l.seconds])).toEqual([
        ['nl', 30],
        ['en', 12],
      ]);
      expect(row?.languages[0]).toMatchObject({ languageName: 'Dutch', targetSeconds: 90 });

      // No German sample yet, but a verified German line makes the profile card appear.
      await test.db
        .update(transcriptSegments)
        .set({ language: 'de' })
        .where(eq(transcriptSegments.id, english.b.id));
      await call('POST', `/people/${person.id}/lines/${english.b.id}/verify`, {});
      const shown = await detail(person.id);
      expect(shown.profiles.map((p) => p.language).sort()).toEqual(['de', 'en', 'nl']);
      expect(shown.profiles.find((p) => p.language === 'de')).toMatchObject({
        samples: 0,
        seconds: 0,
      });
      expect(shown.verified.find((l) => l.id === english.b.id)?.language).toBe('de');
      expect(dutch.meeting.id).toBeTruthy();
    });

    it('deletes one language profile and keeps the others', async () => {
      const { person } = await bilingual();
      await test.db.insert(voiceSamples).values([
        {
          personId: person.id,
          kind: 'imported',
          embedding: [1, 0],
          durationMs: 30_000,
          language: 'nl',
        },
        {
          personId: person.id,
          kind: 'imported',
          embedding: [0, 1],
          durationMs: 12_000,
          language: 'en',
        },
      ]);
      await call('POST', `/people/${person.id}/tracking`, { tracking: 'on' });
      const removed = await call('DELETE', `/people/${person.id}/voice/nl`);
      expect(removed.status).toBe(200);
      const left = (await removed.json()) as PersonDetailDto;
      expect(left.profiles.map((p) => p.language)).toEqual(['en']);
      const [row] = await test.db.select().from(people).where(eq(people.id, person.id));
      expect(row?.voicePrototypes.map((p) => p.language)).toEqual(['en']);
      expect((await call('DELETE', `/people/${person.id}/voice/nl`)).status).toBe(404);
      expect((await call('DELETE', `/people/${person.id}/voice/NOPE`)).status).toBe(404);
      expect((await call('DELETE', `/people/${missing}/voice/en`)).status).toBe(404);
    });
  });

  describe('samples the voice added by itself', () => {
    /** A person with a verified Dutch seed and 3 auto samples from one Dutch meeting. */
    async function seeded() {
      const person = await create({ name: `Auto ${String(Math.random()).slice(2, 8)}` });
      const fixture = await meeting('Auto meeting');
      await test.db
        .update(meetings)
        .set({ language: 'nl' })
        .where(eq(meetings.id, fixture.meeting.id));
      await test.db
        .update(participants)
        .set({ displayName: person.name, personId: person.id, nameConfirmed: true })
        .where(eq(participants.id, fixture.one.id));
      await test.db.insert(voiceSamples).values([
        {
          personId: person.id,
          kind: 'imported',
          embedding: [1, 0],
          durationMs: 40_000,
          language: 'nl',
        },
        ...[fixture.a, fixture.b, fixture.c].map((line) => ({
          personId: person.id,
          kind: 'line' as const,
          segmentId: line.id,
          meetingId: fixture.meeting.id,
          embedding: [1, 0],
          durationMs: 3000,
          language: 'nl',
          source: 'auto' as const,
        })),
      ]);
      return { person, ...fixture };
    }

    it('counts verified and auto speech apart on the profile card', async () => {
      const { person, meeting: m } = await seeded();
      const [card] = (await detail(person.id)).profiles;
      expect(card).toMatchObject({
        language: 'nl',
        seconds: 40,
        autoSamples: 3,
        autoSeconds: 9,
        autoMeetings: [{ meetingId: m.id, title: 'Auto meeting', seconds: 9 }],
      });
      // Auto speech counts less towards the target: 40 s + 0.4 * 9 s.
      expect(card?.effectiveSeconds).toBe(44);
    });

    it('removes the auto samples of a profile and rebuilds it from the verified ones', async () => {
      const { person } = await seeded();
      const removed = await call('DELETE', `/people/${person.id}/voice/nl/auto`);
      expect(removed.status).toBe(200);
      const [card] = ((await removed.json()) as PersonDetailDto).profiles;
      expect(card).toMatchObject({ seconds: 40, autoSamples: 0, autoSeconds: 0 });
      const [row] = await test.db.select().from(people).where(eq(people.id, person.id));
      expect(row?.voicePrototypes).toEqual([{ vector: [1, 0], samples: 1, language: 'nl' }]);
      expect((await call('DELETE', `/people/${missing}/voice/nl/auto`)).status).toBe(404);
    });

    it('removes the auto samples of one meeting for everyone', async () => {
      const { person, meeting: m } = await seeded();
      const response = await call('DELETE', `/people/auto-voices/${m.id}`);
      expect(await response.json()).toEqual({ removed: 3 });
      expect((await detail(person.id)).profiles[0]?.autoSamples).toBe(0);
      expect((await call('DELETE', '/people/auto-voices/nope')).status).toBe(404);
    });

    it('drops a rejected auto sample and asks a bit more margin of that person', async () => {
      const { person, a } = await seeded();
      const rejected = await call('POST', `/people/${person.id}/lines/${a.id}/reject`, {});
      expect(rejected.status).toBe(200);
      const samples = await test.db
        .select()
        .from(voiceSamples)
        .where(eq(voiceSamples.segmentId, a.id));
      expect(samples).toMatchObject([{ rejected: true, source: 'verified' }]);
      const [row] = await test.db.select().from(people).where(eq(people.id, person.id));
      expect(row?.autoMargin).toBeCloseTo(0.02);
    });

    it('turns an auto sample into a verified one when a person confirms the line', async () => {
      const { person, b } = await seeded();
      await call('POST', `/people/${person.id}/lines/${b.id}/verify`, {});
      const [sample] = await test.db
        .select()
        .from(voiceSamples)
        .where(eq(voiceSamples.segmentId, b.id));
      expect(sample?.source).toBe('verified');
    });

    it('does not offer a line the voice learned by itself for training', async () => {
      const { person, a } = await seeded();
      await test.db.insert(audioFiles).values({
        meetingId: a.meetingId,
        path: 'x.opus',
        durationMs: 600_000,
        codec: 'opus',
        size: 1,
      });
      await test.db
        .update(transcriptSegments)
        .set({ speakerConfidence: 0.95 })
        .where(eq(transcriptSegments.meetingId, a.meetingId));
      await test.db.delete(voiceSamples).where(eq(voiceSamples.personId, person.id));
      await test.db.insert(voiceSamples).values({
        personId: person.id,
        kind: 'line',
        segmentId: a.id,
        embedding: [1, 0],
        durationMs: 3000,
        source: 'auto',
      });
      const body = (await (
        await call('GET', `/people/review?personId=${person.id}`)
      ).json()) as ReviewQueueDto;
      const ids = body.lines.map((l) => l.id);
      expect(ids).not.toContain(a.id);
    });
  });

  describe('lines by elimination', () => {
    it('are reviewed with their own reason, even when the confidence looks fine', async () => {
      const person = await create({ name: `Elim ${String(Math.random()).slice(2, 8)}` });
      const fixture = await meeting('Elimination meeting');
      await test.db
        .update(participants)
        .set({ displayName: person.name, personId: person.id, nameConfirmed: true })
        .where(eq(participants.id, fixture.one.id));
      await test.db
        .update(transcriptSegments)
        .set({ speakerConfidence: 0.88, byElimination: true })
        .where(eq(transcriptSegments.id, fixture.a.id));
      const body = (await (
        await call('GET', `/people/review?personId=${person.id}`)
      ).json()) as ReviewQueueDto;
      const card = body.lines.find((l) => l.id === fixture.a.id);
      expect(card).toMatchObject({ reason: 'elimination', why: 'doubt' });
      // A person confirming the line clears the flag.
      await call('POST', `/people/${person.id}/lines/${fixture.a.id}/verify`, {});
      const [row] = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.id, fixture.a.id));
      expect(row?.byElimination).toBe(false);
    });
  });

  describe('review scopes and order', () => {
    const queue = async (query = '') => {
      const response = await call('GET', `/people/review${query}`);
      expect(response.status).toBe(200);
      return (await response.json()) as ReviewQueueDto;
    };

    /** Two meetings a day apart, each with one line of a different person. */
    async function twoMeetings() {
      const tag = String(Math.random()).slice(2, 8);
      const [first, second] = [
        await create({ name: `Ada ${tag}` }),
        await create({ name: `Ben ${tag}` }),
      ];
      const older = await meeting(`Older ${tag}`);
      const newer = await meeting(`Newer ${tag}`);
      await test.db
        .update(meetings)
        .set({ createdAt: new Date('2026-01-01T10:00:00Z') })
        .where(eq(meetings.id, older.meeting.id));
      await test.db
        .update(meetings)
        .set({ createdAt: new Date('2026-01-02T10:00:00Z') })
        .where(eq(meetings.id, newer.meeting.id));
      // The older meeting holds the least sure line, the newer one a surer line of another person.
      await test.db
        .update(participants)
        .set({ displayName: first.name, personId: first.id, nameConfirmed: true })
        .where(eq(participants.id, older.one.id));
      await test.db
        .update(participants)
        .set({ displayName: second.name, personId: second.id, nameConfirmed: true })
        .where(eq(participants.id, newer.one.id));
      await test.db
        .update(transcriptSegments)
        .set({ speakerConfidence: 0.1 })
        .where(eq(transcriptSegments.id, older.a.id));
      await test.db
        .update(transcriptSegments)
        .set({ speakerConfidence: 0.6 })
        .where(eq(transcriptSegments.id, older.b.id));
      await test.db
        .update(transcriptSegments)
        .set({ speakerConfidence: 0.5 })
        .where(eq(transcriptSegments.id, newer.a.id));
      await test.db
        .update(transcriptSegments)
        .set({ speakerConfidence: 0.55 })
        .where(eq(transcriptSegments.id, newer.b.id));
      return { first, second, older, newer };
    }

    /** Settles every other line, so the session cap leaves room for the fixture. */
    const settleOthers = (ours: Set<string>) =>
      test.db
        .update(transcriptSegments)
        .set({ speakerSource: 'user' })
        .where(notInArray(transcriptSegments.id, [...ours]));

    it('goes through all people newest meeting first, then in the order spoken', async () => {
      const { first, second, older, newer } = await twoMeetings();
      const ours = new Set([older.a.id, older.b.id, newer.a.id, newer.b.id]);
      await settleOthers(ours);
      const body = await queue();
      expect(body.order).toBe('newest');
      expect(body.lines.map((l) => l.id).filter((id) => ours.has(id))).toEqual([
        newer.a.id,
        newer.b.id,
        older.a.id,
        older.b.id,
      ]);
      expect(body.lines.find((l) => l.id === newer.a.id)?.proposed.id).toBe(second.id);
      expect(body.lines.find((l) => l.id === older.a.id)?.proposed.id).toBe(first.id);
      expect(body.lines.find((l) => l.id === newer.a.id)?.meetingDate).toBe(
        '2026-01-02T10:00:00.000Z',
      );
    });

    it('can start with the least sure line instead', async () => {
      const { older, newer } = await twoMeetings();
      const ours = new Set([older.a.id, older.b.id, newer.a.id, newer.b.id]);
      await settleOthers(ours);
      const body = await queue('?order=uncertain');
      expect(body.order).toBe('uncertain');
      expect(body.lines.map((l) => l.id).filter((id) => ours.has(id))).toEqual([
        older.a.id,
        newer.a.id,
        newer.b.id,
        older.b.id,
      ]);
      expect((await call('GET', '/people/review?order=sideways')).status).toBe(404);
    });

    it('scopes to one meeting, one person, or both', async () => {
      const { first, older, newer } = await twoMeetings();
      const byMeeting = await queue(`?meetingId=${newer.meeting.id}`);
      expect(byMeeting.lines.map((l) => l.id)).toEqual([newer.a.id, newer.b.id]);
      expect(byMeeting.scope.meeting).toMatchObject({ id: newer.meeting.id });
      expect(byMeeting.scope.person).toBeUndefined();

      const byPerson = await queue(`?personId=${first.id}`);
      expect(byPerson.lines.map((l) => l.id)).toEqual([older.a.id, older.b.id]);
      expect(byPerson.scope.person).toMatchObject({ id: first.id, name: first.name });

      const both = await queue(`?personId=${first.id}&meetingId=${newer.meeting.id}`);
      expect(both.lines).toEqual([]);
      const other = await queue(`?personId=${first.id}&meetingId=${older.meeting.id}`);
      expect(other.lines.map((l) => l.id)).toEqual([older.a.id, older.b.id]);
    });

    it('answers 404 for a meeting that does not exist or an id that is not one', async () => {
      expect((await call('GET', `/people/review?meetingId=${missing}`)).status).toBe(404);
      expect((await call('GET', '/people/review?meetingId=nope')).status).toBe(404);
    });
  });

  describe('do not track', () => {
    async function pair() {
      const tag = String(Math.random()).slice(2, 8);
      const muted = await create({ name: `Mute ${tag}`, emails: [`mute${tag}@example.com`] });
      const carl = await create({ name: `Carl ${tag}` });
      const fixture = await meeting(`Muted ${tag}`);
      await test.db
        .update(participants)
        .set({
          displayName: muted.name,
          personId: muted.id,
          nameConfirmed: true,
          voiceEmbedding: [1, 0],
        })
        .where(eq(participants.id, fixture.one.id));
      await test.db
        .update(participants)
        .set({ displayName: carl.name, personId: carl.id, nameConfirmed: true })
        .where(eq(participants.id, fixture.two.id));
      // Carl's line lists the muted person as the runner up and as a speaker in the meeting.
      await test.db
        .update(transcriptSegments)
        .set({
          speakerConfidence: 0.3,
          speakerCandidates: [
            { participantId: fixture.two.id, score: 0.6 },
            { participantId: fixture.one.id, score: 0.4 },
          ],
        })
        .where(eq(transcriptSegments.id, fixture.c.id));
      await addVoiceSamples(test.db, muted.id, [
        { kind: 'imported', embedding: [1, 0] },
        {
          kind: 'line',
          embedding: [0.9, 0.1],
          segmentId: fixture.a.id,
          meetingId: fixture.meeting.id,
        },
      ]);
      return { muted, carl, ...fixture };
    }
    const off = (id: string) => call('POST', `/people/${id}/tracking`, { tracking: 'off' });
    const on = (id: string) => call('POST', `/people/${id}/tracking`, { tracking: 'on' });

    it('deletes the voice, keeps the name and says so on the person', async () => {
      const { muted, one, meeting: row } = await pair();
      const before = await detail(muted.id);
      expect(before.person).toMatchObject({ tracking: 'on', samples: 2 });
      const response = await off(muted.id);
      expect(response.status).toBe(200);
      const after = (await response.json()) as PersonDetailDto;
      expect(after.person).toMatchObject({ tracking: 'off', samples: 0, voiceSeconds: 0 });
      expect(after.prototypes).toBe(0);
      expect(after.review).toEqual([]);
      expect(
        await test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, muted.id)),
      ).toEqual([]);
      const [seat] = await test.db.select().from(participants).where(eq(participants.id, one.id));
      expect(seat).toMatchObject({
        displayName: muted.name,
        personId: muted.id,
        voiceEmbedding: null,
      });
      const segments = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.meetingId, row.id));
      expect(segments.filter((s) => s.participantId === one.id)).toHaveLength(2);
    });

    it("keeps their lines out of every review queue and them out of other lines' lists", async () => {
      const { muted, carl, a, c } = await pair();
      const mine = async (query = '') =>
        ((await (await call('GET', `/people/review${query}`)).json()) as ReviewQueueDto).lines;
      expect((await mine(`?personId=${muted.id}`)).map((l) => l.id)).toContain(a.id);
      const withHim = (await mine(`?personId=${carl.id}`)).find((l) => l.id === c.id);
      expect(withHim?.considered.map((x) => x.name)).toContain(muted.name);
      expect(withHim?.roster.map((r) => r.personId)).toContain(muted.id);

      await off(muted.id);

      expect(await mine(`?personId=${muted.id}`)).toEqual([]);
      expect((await mine()).some((l) => l.id === a.id)).toBe(false);
      expect((await mine()).some((l) => l.proposed.id === muted.id)).toBe(false);
      const after = (await mine(`?personId=${carl.id}`)).find((l) => l.id === c.id);
      expect(after?.considered.map((x) => x.name)).not.toContain(muted.name);
      expect(after?.roster.map((r) => r.personId)).not.toContain(muted.id);
      const body = (await (await call('GET', '/people/review')).json()) as ReviewQueueDto;
      const listed = body.people.find((p) => p.id === muted.id);
      expect(listed).toMatchObject({ name: muted.name, tracked: false });
    });

    it('stays reachable by name in the full list, the filter and on its page', async () => {
      const { muted } = await pair();
      await off(muted.id);
      const names = async (query: string) =>
        ((await (await call('GET', `/people${query}`)).json()) as PeopleDto).people.map(
          (p) => p.name,
        );
      expect(await names('')).not.toContain(muted.name);
      expect(await names('?tracking=tracked')).not.toContain(muted.name);
      expect(await names('?tracking=untracked')).toContain(muted.name);
      expect(await names('?tracking=all')).toContain(muted.name);
      const choices = (await detail((await create({ name: `Other ${muted.id.slice(0, 6)}` })).id))
        .choices;
      expect(choices.find((c) => c.id === muted.id)).toMatchObject({ tracked: false });
    });

    it('learns nothing when a line is confirmed or moved to them, and never queues voice learning', async () => {
      const { muted, carl, b, c } = await pair();
      await settings.set('voices.remember', 'true');
      await off(muted.id);
      sent.length = 0;
      expect(
        (await call('POST', `/people/${carl.id}/lines/${c.id}/move`, { personId: muted.id }))
          .status,
      ).toBe(200);
      expect((await call('POST', `/people/${muted.id}/lines/${b.id}/verify`, {})).status).toBe(200);
      expect(sent.filter((job) => job.name === 'meeting.learn-voice')).toEqual([]);
      expect(
        await test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, muted.id)),
      ).toEqual([]);
      // The label still moves: it is only the learning that is off.
      const [moved] = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.id, c.id));
      expect(moved?.speakerSource).toBe('user');
      await settings.set('voices.remember', 'false');
    });

    it('does not train anyone on Not X, unsure who', async () => {
      const { carl, c, two } = await pair();
      await settings.set('voices.remember', 'true');
      sent.length = 0;
      await test.db
        .update(transcriptSegments)
        .set({ participantId: two.id, speakerCandidates: [{ participantId: two.id, score: 0.6 }] })
        .where(eq(transcriptSegments.id, c.id));
      const reject = await call('POST', `/people/${carl.id}/lines/${c.id}/reject`, {});
      expect([200, 409]).toContain(reject.status);
      expect(sent.filter((job) => job.name === 'meeting.learn-voice')).toEqual([]);
      const samples = await test.db
        .select()
        .from(voiceSamples)
        .where(eq(voiceSamples.personId, carl.id));
      expect(samples.every((sample) => sample.rejected && sample.embedding === null)).toBe(true);
      await settings.set('voices.remember', 'false');
    });

    it('can track again, and learning resumes from nothing', async () => {
      const { muted, b } = await pair();
      await off(muted.id);
      const back = (await (await on(muted.id)).json()) as PersonDetailDto;
      expect(back.person).toMatchObject({ tracking: 'on', samples: 0 });
      await addVoiceSamples(test.db, muted.id, [
        { kind: 'line', embedding: [1, 0], segmentId: b.id },
      ]);
      expect((await detail(muted.id)).person.samples).toBe(1);
      expect((await call('POST', `/people/${missing}/tracking`, { tracking: 'off' })).status).toBe(
        404,
      );
      expect(
        (await call('POST', `/people/${muted.id}/tracking`, { tracking: 'maybe' })).status,
      ).toBe(400);
    });

    it('keeps them untracked, without a voice, when merged with a tracked person', async () => {
      const keep = await create({ name: `Keep Tracked ${String(Math.random()).slice(2, 6)}` });
      const muted = await create({ name: `Mute Merge ${String(Math.random()).slice(2, 6)}` });
      await addVoiceSamples(test.db, keep.id, [{ kind: 'imported', embedding: [1, 0] }]);
      await off(muted.id);
      const merged = (await (
        await call('POST', `/people/${keep.id}/merge`, { sourceId: muted.id })
      ).json()) as PersonDetailDto;
      expect(merged.person).toMatchObject({ tracking: 'off', samples: 0 });
      expect(
        await test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, keep.id)),
      ).toEqual([]);
    });
  });

  describe('possible duplicates', () => {
    it('hints at both people but never merges them', async () => {
      const tag = String(Math.random()).slice(2, 8);
      const short = await create({ name: `Dennis${tag}`, emails: [`dennis@${tag}.example.com`] });
      const long = await create({ name: `Dennis${tag} Klappe`, emails: [`dk@${tag}.example.com`] });
      const lone = await create({ name: `Lonely ${tag}`, emails: [`l@${tag}.example.org`] });
      const list = (await (await call('GET', `/people?q=${tag}`)).json()) as PeopleDto;
      const of = (id: string) => list.people.find((p) => p.id === id);
      expect(of(short.id)?.duplicates).toEqual([{ id: long.id, name: long.name }]);
      expect(of(long.id)?.duplicates).toEqual([{ id: short.id, name: short.name }]);
      expect(of(lone.id)?.duplicates).toEqual([]);
      expect(list.total).toBe(3);
    });
  });
});
