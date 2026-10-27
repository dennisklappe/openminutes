import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore, type JobName, type JobPayloads } from '@openminutes/core';
import {
  and,
  audioFiles,
  eq,
  inArray,
  meetings,
  participants,
  reviewDecisions,
  transcriptSegments,
  voiceSamples,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { PersonDetailDto, ReviewQueueDto, SpeakerEditResultDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('mixed lines', () => {
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
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-mixed-'))),
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
    await settings.set('voices.remember', 'true');
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
  const row = async (id: string) => {
    const [found] = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.id, id));
    if (!found) throw new Error('missing line');
    return found;
  };
  const person = async (name: string) => {
    const response = await call('POST', '/people', {
      name: `${name} ${String(Math.random()).slice(2, 8)}`,
    });
    return ((await response.json()) as PersonDetailDto).person;
  };

  /** One meeting where Anna is labelled on a long line that Bram started speaking in halfway. */
  async function room(text = 'Thanks everyone for joining today and now over to you Bram please') {
    const anna = await person('Anna');
    const bram = await person('Bram');
    const [m] = await test.db
      .insert(meetings)
      .values({ title: 'Mixed meeting', platform: 'meet', joinUrl: '', status: 'transcribed' })
      .returning();
    if (!m) throw new Error('insert failed');
    await test.db
      .insert(audioFiles)
      .values({ meetingId: m.id, path: 'none.opus', durationMs: 60000, codec: 'opus', size: 1 });
    const [annaSeat, bramSeat] = await test.db
      .insert(participants)
      .values([
        { meetingId: m.id, displayName: anna.name, personId: anna.id, nameConfirmed: true },
        { meetingId: m.id, displayName: bram.name, personId: bram.id, nameConfirmed: true },
      ])
      .returning();
    if (!annaSeat || !bramSeat) throw new Error('insert failed');
    const [line] = await test.db
      .insert(transcriptSegments)
      .values({
        meetingId: m.id,
        participantId: annaSeat.id,
        startMs: 10000,
        endMs: 20000,
        text,
        speakerConfidence: 0.95,
        speakerSource: 'diarization',
      })
      .returning();
    if (!line) throw new Error('insert failed');
    return { anna, bram, annaSeat, bramSeat, meeting: m, line };
  }
  const sample = (personId: string, segmentId: string, meetingId: string) =>
    test.db.insert(voiceSamples).values({
      personId,
      kind: 'line',
      segmentId,
      meetingId,
      embedding: [1, 0],
      durationMs: 3000,
    });

  describe('marking a line as mixed', () => {
    it('keeps the label, drops the samples and leaves the queue and counts', async () => {
      const { anna, line, meeting: m } = await room();
      await test.db
        .update(transcriptSegments)
        .set({ speakerConfidence: 0.2 })
        .where(eq(transcriptSegments.id, line.id));
      expect((await queue(`?personId=${anna.id}`)).lines.map((l) => l.id)).toContain(line.id);
      await sample(anna.id, line.id, m.id);
      sent.length = 0;
      const response = await call('POST', `/people/${anna.id}/lines/${line.id}/mixed`, {});
      expect(response.status).toBe(200);
      expect(await row(line.id)).toMatchObject({ mixed: 'marked', speakerSource: 'diarization' });
      expect(
        await test.db.select().from(voiceSamples).where(eq(voiceSamples.segmentId, line.id)),
      ).toEqual([]);
      expect(sent).toEqual([]);
      const after = await queue(`?personId=${anna.id}`);
      expect(after.lines.map((l) => l.id)).not.toContain(line.id);
      expect((await queue(`?personId=${anna.id}&skipped=1`)).lines.map((l) => l.id)).not.toContain(
        line.id,
      );
      const detail = (await (await call('GET', `/people/${anna.id}`)).json()) as PersonDetailDto;
      expect(detail.review.map((l) => l.id)).not.toContain(line.id);
      expect(detail.person.needsReview).toBe(after.lines.length);
    });

    it('also hides a confirmed line from training and from the verified list', async () => {
      const { anna, line } = await room();
      await call('POST', `/people/${anna.id}/lines/${line.id}/verify`, {});
      expect(
        ((await (await call('GET', `/people/${anna.id}`)).json()) as PersonDetailDto).verified.map(
          (l) => l.id,
        ),
      ).toContain(line.id);
      await call('POST', `/people/${anna.id}/lines/${line.id}/mixed`, {});
      expect(
        ((await (await call('GET', `/people/${anna.id}`)).json()) as PersonDetailDto).verified.map(
          (l) => l.id,
        ),
      ).not.toContain(line.id);
    });

    it('is not offered for training even though it is sure and long', async () => {
      const { anna, line } = await room();
      expect((await queue(`?personId=${anna.id}`)).lines.map((l) => l.id)).toContain(line.id);
      await call('POST', `/people/${anna.id}/lines/${line.id}/mixed`, {});
      expect((await queue(`?personId=${anna.id}`)).lines.map((l) => l.id)).not.toContain(line.id);
    });

    it('undoes: the flag, its decision and the queue entry come back as before', async () => {
      const { anna, line } = await room();
      await test.db
        .update(transcriptSegments)
        .set({ mixed: 'probable' })
        .where(eq(transcriptSegments.id, line.id));
      await call('POST', `/people/${anna.id}/lines/${line.id}/mixed`, {});
      expect((await row(line.id)).mixed).toBe('marked');
      const undone = await call('POST', '/people/review/undo', { segmentId: line.id });
      expect(await undone.json()).toEqual({ undone: 'mixed' });
      expect((await row(line.id)).mixed).toBe('probable');
      expect(
        await test.db.select().from(reviewDecisions).where(eq(reviewDecisions.segmentId, line.id)),
      ).toEqual([]);
    });

    it('is cleared from the transcript, which forgets the decision and can be undone', async () => {
      const { anna, line, meeting: m } = await room();
      await call('POST', `/people/${anna.id}/lines/${line.id}/mixed`, {});
      const response = await call('POST', `/meetings/${m.id}/speaker-edits`, {
        kind: 'clear-mixed',
        segmentIds: [line.id],
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as SpeakerEditResultDto;
      expect(result.segments.find((s) => s.id === line.id)?.mixed).toBeNull();
      expect((await row(line.id)).mixed).toBeNull();
      expect(
        await test.db
          .select()
          .from(reviewDecisions)
          .where(and(eq(reviewDecisions.segmentId, line.id), eq(reviewDecisions.kind, 'mixed'))),
      ).toEqual([]);
      const back = await call('POST', `/meetings/${m.id}/speaker-edits`, result.undo);
      expect(back.status).toBe(200);
      expect((await row(line.id)).mixed).toBe('marked');
    });

    it('answers 404 for a missing line or person', async () => {
      const { anna, line } = await room();
      const missing = '00000000-0000-4000-8000-000000000000';
      expect((await call('POST', `/people/${anna.id}/lines/${missing}/mixed`, {})).status).toBe(
        404,
      );
      expect((await call('POST', `/people/${missing}/lines/${line.id}/mixed`, {})).status).toBe(
        404,
      );
    });
  });

  describe('a line the voice guard thinks is mixed', () => {
    it('is asked about even when the label is sure, with its own reason', async () => {
      const { anna, line } = await room();
      await test.db
        .update(transcriptSegments)
        .set({ mixed: 'probable', speakerSource: 'user' })
        .where(eq(transcriptSegments.id, line.id));
      const lines = (await queue(`?personId=${anna.id}`)).lines;
      expect(lines.find((l) => l.id === line.id)).toMatchObject({
        reason: 'mixed',
        why: 'doubt',
        proposed: { id: anna.id },
      });
      const detail = (await (await call('GET', `/people/${anna.id}`)).json()) as PersonDetailDto;
      expect(detail.review.find((l) => l.id === line.id)?.reason).toBe('mixed');
      expect(detail.person.needsReview).toBe(lines.length);
    });

    it('is asked about even when it is short', async () => {
      const { anna, line } = await room('Okay thanks');
      await test.db
        .update(transcriptSegments)
        .set({ mixed: 'probable', endMs: 11000 })
        .where(eq(transcriptSegments.id, line.id));
      expect((await queue(`?personId=${anna.id}`)).lines.map((l) => l.id)).toContain(line.id);
    });

    it('is settled by approving it, which clears the doubt and can be undone', async () => {
      const { anna, line } = await room();
      await test.db
        .update(transcriptSegments)
        .set({ mixed: 'probable' })
        .where(eq(transcriptSegments.id, line.id));
      await call('POST', `/people/${anna.id}/lines/${line.id}/verify`, {});
      expect((await row(line.id)).mixed).toBeNull();
      await call('POST', '/people/review/undo', { segmentId: line.id });
      expect((await row(line.id)).mixed).toBe('probable');
    });
  });

  describe('splitting a line', () => {
    const text = 'Thanks everyone for joining today and now over to you Bram please';
    const split = (id: string, line: string, body: object) =>
      call('POST', `/people/${id}/lines/${line}/split`, body);

    it('gives the parts to their people as verified lines and queues learning for long ones', async () => {
      const { anna, bram, annaSeat, bramSeat, line, meeting: m } = await room(text);
      await sample(anna.id, line.id, m.id);
      await test.db
        .update(transcriptSegments)
        .set({ mixed: 'probable' })
        .where(eq(transcriptSegments.id, line.id));
      sent.length = 0;
      const response = await split(anna.id, line.id, { cuts: [7], personIds: [anna.id, bram.id] });
      expect(response.status).toBe(200);
      const parts = (
        await test.db
          .select()
          .from(transcriptSegments)
          .where(eq(transcriptSegments.meetingId, m.id))
      ).toSorted((x, y) => x.startMs - y.startMs);
      expect(parts.map((p) => p.text)).toEqual([
        'Thanks everyone for joining today and now',
        'over to you Bram please',
      ]);
      expect(parts.map((p) => p.participantId)).toEqual([annaSeat.id, bramSeat.id]);
      expect(parts.every((p) => p.speakerSource === 'user' && p.mixed === null)).toBe(true);
      expect(parts[0]?.startMs).toBe(10000);
      expect(parts[0]?.endMs).toBe(parts[1]?.startMs);
      expect(parts[1]?.endMs).toBe(20000);
      expect(
        await test.db.select().from(voiceSamples).where(eq(voiceSamples.segmentId, line.id)),
      ).toEqual([]);
      expect(sent.map((job) => job.payload)).toEqual([
        { meetingId: m.id, participantId: annaSeat.id, segmentIds: [parts[0]?.id] },
        { meetingId: m.id, participantId: bramSeat.id, segmentIds: [parts[1]?.id] },
      ]);
      const detail = (await (await call('GET', `/people/${bram.id}`)).json()) as PersonDetailDto;
      expect(detail.verified.map((l) => l.id)).toContain(parts[1]?.id);
    });

    it('only labels a part too short to teach a voice', async () => {
      const { anna, bram, line, meeting: m } = await room(text);
      sent.length = 0;
      expect(
        (await split(anna.id, line.id, { cuts: [2], personIds: [anna.id, bram.id] })).status,
      ).toBe(200);
      const parts = (
        await test.db
          .select()
          .from(transcriptSegments)
          .where(eq(transcriptSegments.meetingId, m.id))
      ).toSorted((x, y) => x.startMs - y.startMs);
      expect(parts[0]?.text).toBe('Thanks everyone');
      expect(parts[0]?.speakerSource).toBe('user');
      expect(sent.map((job) => (job.payload as { segmentIds: string[] }).segmentIds)).toEqual([
        [parts[1]?.id],
      ]);
    });

    it('splits in three, and the parts of one person are learned together', async () => {
      const {
        anna,
        bram,
        annaSeat,
        line,
        meeting: m,
      } = await room(
        'Thanks everyone for joining today and now over to you Bram please go ahead with the update',
      );
      sent.length = 0;
      const response = await split(anna.id, line.id, {
        cuts: [7, 11],
        personIds: [anna.id, bram.id, anna.id],
      });
      expect(response.status).toBe(200);
      const parts = (
        await test.db
          .select()
          .from(transcriptSegments)
          .where(eq(transcriptSegments.meetingId, m.id))
      ).toSorted((x, y) => x.startMs - y.startMs);
      expect(parts).toHaveLength(3);
      const forAnna = sent.find(
        (job) => (job.payload as { participantId: string }).participantId === annaSeat.id,
      );
      expect((forAnna?.payload as { segmentIds: string[] }).segmentIds).toEqual([
        parts[0]?.id,
        parts[2]?.id,
      ]);
    });

    it('drops the line from the queue, and Undo restores it and removes the parts', async () => {
      const { anna, bram, line, meeting: m } = await room(text);
      await test.db
        .update(transcriptSegments)
        .set({ mixed: 'probable' })
        .where(eq(transcriptSegments.id, line.id));
      await split(anna.id, line.id, { cuts: [7], personIds: [anna.id, bram.id] });
      expect((await queue(`?personId=${anna.id}`)).lines.map((l) => l.id)).not.toContain(line.id);
      const [added] = await test.db
        .select()
        .from(transcriptSegments)
        .where(
          and(
            eq(transcriptSegments.meetingId, m.id),
            eq(transcriptSegments.text, 'over to you Bram please'),
          ),
        );
      if (!added) throw new Error('part missing');
      await sample(bram.id, added.id, m.id);
      const undone = await call('POST', '/people/review/undo', { segmentId: line.id });
      expect(await undone.json()).toEqual({ undone: 'split' });
      const all = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.meetingId, m.id));
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        id: line.id,
        text,
        endMs: 20000,
        mixed: 'probable',
        speakerSource: 'diarization',
      });
      expect(
        await test.db
          .select()
          .from(voiceSamples)
          .where(inArray(voiceSamples.personId, [anna.id, bram.id])),
      ).toEqual([]);
    });

    it('refuses bad cuts and a person per part that does not add up', async () => {
      const { anna, bram, line } = await room(text);
      expect(
        (await split(anna.id, line.id, { cuts: [0], personIds: [anna.id, bram.id] })).status,
      ).toBe(400);
      expect(
        (await split(anna.id, line.id, { cuts: [99], personIds: [anna.id, bram.id] })).status,
      ).toBe(400);
      expect((await split(anna.id, line.id, { cuts: [3], personIds: [anna.id] })).status).toBe(400);
      expect(
        (await split(anna.id, line.id, { cuts: [3, 5], personIds: [anna.id, bram.id] })).status,
      ).toBe(400);
      expect((await row(line.id)).text).toBe(text);
    });

    it('splits a marked line and forgets the mark', async () => {
      const { anna, bram, line } = await room(text);
      await call('POST', `/people/${anna.id}/lines/${line.id}/mixed`, {});
      expect(
        (await split(anna.id, line.id, { cuts: [7], personIds: [anna.id, bram.id] })).status,
      ).toBe(200);
      expect((await row(line.id)).mixed).toBeNull();
    });
  });
});
