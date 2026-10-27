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
  eq,
  meetings,
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
      text: `Synthetic line ${String(i)}`,
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
});
