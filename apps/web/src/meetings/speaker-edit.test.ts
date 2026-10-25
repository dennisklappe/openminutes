import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore, type JobName, type JobPayloads } from '@openminutes/core';
import { eq, meetings, participants, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type {
  MeetingDetailDto,
  SegmentDto,
  SpeakerEditInput,
  SpeakerEditResultDto,
} from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const missing = '00000000-0000-4000-8000-000000000000';

describe('speaker edits', () => {
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
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-edits-'))),
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

  async function fixture(platform: 'recording' | 'meet' = 'recording') {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Call', platform, joinUrl: '', status: 'transcribed' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const people = await test.db
      .insert(participants)
      .values([
        { meetingId: meeting.id, displayName: 'Speaker 1' },
        { meetingId: meeting.id, displayName: 'Speaker 2' },
      ])
      .returning();
    const [one, two] = people;
    if (!one || !two) throw new Error('insert failed');
    const rows = await test.db
      .insert(transcriptSegments)
      .values([
        line(meeting.id, one.id, 0, 'Hello there everyone'),
        line(meeting.id, two.id, 4000, 'Good morning to you'),
        line(meeting.id, two.id, 8000, 'Shall we begin now'),
      ])
      .returning();
    const [a, b, c] = rows.toSorted((x, y) => x.startMs - y.startMs);
    if (!a || !b || !c) throw new Error('insert failed');
    return { meeting, one, two, a, b, c };
  }

  const line = (meetingId: string, participantId: string, startMs: number, text: string) => ({
    meetingId,
    participantId,
    startMs,
    endMs: startMs + 4000,
    text,
    speakerConfidence: 0.4,
    speakerSource: 'diarization' as const,
  });

  const detail = async (id: string) =>
    (await (await call('GET', `/meetings/${id}`)).json()) as MeetingDetailDto;

  const edit = (id: string, body: SpeakerEditInput) =>
    call('POST', `/meetings/${id}/speaker-edits`, body);

  const applied = async (id: string, body: SpeakerEditInput) => {
    const response = await edit(id, body);
    expect(response.status).toBe(200);
    return (await response.json()) as SpeakerEditResultDto;
  };

  describe('detail', () => {
    it('fills the speaker fields and the choices in order of appearance', async () => {
      const { meeting, one, two, a } = await fixture();
      await test.db.insert(participants).values({ meetingId: meeting.id, displayName: 'Anna' });
      const body = await detail(meeting.id);
      expect(body.segments[0]).toMatchObject({
        id: a.id,
        speaker: 'Speaker 1',
        speakerId: one.id,
        speakerConfidence: expect.closeTo(0.4) as number,
        speakerSource: 'diarization',
        uncertain: true,
        previousSpeaker: null,
      });
      expect(body.speakerChoices.map((choice) => choice.name)).toEqual([
        'Speaker 1',
        'Speaker 2',
        'Anna',
      ]);
      expect(body.speakerChoices[1]?.id).toBe(two.id);
      expect(body.speakerCheck).toEqual({
        ai: false,
        running: false,
        checkedAt: null,
        error: null,
      });
    });
  });

  describe('assign', () => {
    it('assigns to an existing speaker as the user and undoes back to the original', async () => {
      const { meeting, one, two, a } = await fixture();
      const before = (await detail(meeting.id)).segments;
      const result = await applied(meeting.id, {
        kind: 'assign',
        segmentIds: [a.id],
        speaker: { id: two.id },
      });
      expect(result.segments[0]).toMatchObject({
        speakerId: two.id,
        speakerSource: 'user',
        uncertain: false,
        previousSpeaker: 'Speaker 1',
        text: a.text,
      });
      expect(result.speakerChoices).toHaveLength(2);
      const undone = await applied(meeting.id, result.undo);
      expect(undone.segments).toEqual(before);
      expect(before[0]?.speakerId).toBe(one.id);
    });

    it('keeps the original guess when a user line is assigned again', async () => {
      const { meeting, one, two, a } = await fixture();
      const anna = await applied(meeting.id, {
        kind: 'assign',
        segmentIds: [a.id],
        speaker: { name: 'Anna' },
      });
      await applied(meeting.id, { kind: 'assign', segmentIds: [a.id], speaker: { id: two.id } });
      const [row] = await test.db
        .select()
        .from(transcriptSegments)
        .where(eq(transcriptSegments.id, a.id));
      expect(row?.previousParticipantId).toBe(one.id);
      expect(anna.speakerChoices.map((choice) => choice.name)).toContain('Anna');
    });

    it('reuses a speaker with that exact name and creates the next free generic one', async () => {
      const { meeting, two, a, b } = await fixture();
      const named = await applied(meeting.id, {
        kind: 'assign',
        segmentIds: [a.id],
        speaker: { name: 'Speaker 2' },
      });
      expect(named.segments[0]?.speakerId).toBe(two.id);
      const created = await applied(meeting.id, {
        kind: 'assign',
        segmentIds: [b.id],
        speaker: { create: true },
      });
      expect(created.segments[1]?.speaker).toBe('Speaker 3');
      const undone = await applied(meeting.id, created.undo);
      expect(undone.speakerChoices.map((choice) => choice.name)).toEqual([
        'Speaker 2',
        'Speaker 1',
      ]);
    });

    it('rejects lines and speakers from elsewhere, and bad input', async () => {
      const first = await fixture();
      const other = await fixture();
      const bad: SpeakerEditInput[] = [
        { kind: 'assign', segmentIds: [other.a.id], speaker: { id: first.one.id } },
        { kind: 'assign', segmentIds: [first.a.id], speaker: { id: other.one.id } },
        { kind: 'assign', segmentIds: [first.a.id], speaker: { id: missing } },
        { kind: 'assign', segmentIds: [missing], speaker: { create: true } },
      ];
      for (const body of bad) expect((await edit(first.meeting.id, body)).status).toBe(400);
      for (const body of [
        { kind: 'assign', segmentIds: [], speaker: { create: true } },
        { kind: 'assign', segmentIds: ['nope'], speaker: { create: true } },
        { kind: 'assign', segmentIds: [first.a.id], speaker: { name: '  ' } },
        { kind: 'assign', segmentIds: [first.a.id], speaker: { create: true }, extra: 1 },
        { kind: 'unknown' },
      ])
        expect(
          (await call('POST', `/meetings/${first.meeting.id}/speaker-edits`, body)).status,
        ).toBe(400);
      expect((await edit(missing, bad[0] as SpeakerEditInput)).status).toBe(404);
    });
  });

  describe('voice learning', () => {
    it('only queues a voice to learn from when remembering is on', async () => {
      const { meeting, two, a } = await fixture();
      const assign: SpeakerEditInput = {
        kind: 'assign',
        segmentIds: [a.id],
        speaker: { id: two.id },
      };
      sent.length = 0;
      await applied(meeting.id, assign);
      expect(sent).toEqual([]);
      await settings.set('voices.remember', 'true');
      const result = await applied(meeting.id, assign);
      expect(sent).toEqual([
        {
          name: 'meeting.learn-voice',
          payload: { meetingId: meeting.id, participantId: two.id, segmentIds: [a.id] },
        },
      ]);
      await applied(meeting.id, result.undo);
      await applied(meeting.id, { kind: 'revert', segmentIds: [a.id] });
      expect(sent).toHaveLength(1);
      await settings.set('voices.remember', 'false');
    });
  });

  describe('split', () => {
    it('splits before a word, proportionally in time, and undoes', async () => {
      const { meeting, a } = await fixture();
      const before = (await detail(meeting.id)).segments;
      const result = await applied(meeting.id, { kind: 'split', segmentId: a.id, wordIndex: 1 });
      const [first, second] = result.segments;
      expect([first?.text, second?.text]).toEqual(['Hello', 'there everyone']);
      expect(`${first?.text} ${second?.text}`).toBe(a.text);
      expect(first).toMatchObject({ startMs: 0, endMs: 1000, speakerId: a.participantId });
      expect(second).toMatchObject({
        startMs: 1000,
        endMs: 4000,
        speakerConfidence: first?.speakerConfidence,
      });
      expect(result.segments).toHaveLength(4);
      expect((await applied(meeting.id, result.undo)).segments).toEqual(before);
    });

    it('gives the second half to another speaker as the user', async () => {
      const { meeting, two, a } = await fixture();
      const result = await applied(meeting.id, {
        kind: 'split',
        segmentId: a.id,
        wordIndex: 2,
        speaker: { id: two.id },
      });
      expect(result.segments[0]).toMatchObject({
        speaker: 'Speaker 1',
        speakerSource: 'diarization',
      });
      expect(result.segments[1]).toMatchObject({
        speakerId: two.id,
        speakerSource: 'user',
        previousSpeaker: 'Speaker 1',
      });
    });

    it('normalises whitespace and rejects word positions outside the text', async () => {
      const { meeting, a } = await fixture();
      await test.db
        .update(transcriptSegments)
        .set({ text: '  one   two three ' })
        .where(eq(transcriptSegments.id, a.id));
      for (const wordIndex of [0, 3, 9]) {
        expect((await edit(meeting.id, { kind: 'split', segmentId: a.id, wordIndex })).status).toBe(
          400,
        );
      }
      const result = await applied(meeting.id, { kind: 'split', segmentId: a.id, wordIndex: 2 });
      expect([result.segments[0]?.text, result.segments[1]?.text]).toEqual(['one two', 'three']);
    });
  });

  describe('merge', () => {
    it('joins neighbouring lines into the first and undoes', async () => {
      const { meeting, one, b, c } = await fixture();
      const before = (await detail(meeting.id)).segments;
      const result = await applied(meeting.id, { kind: 'merge', segmentIds: [c.id, b.id] });
      expect(result.segments).toHaveLength(2);
      expect(result.segments[1]).toMatchObject({
        id: b.id,
        text: 'Good morning to you Shall we begin now',
        startMs: 4000,
        endMs: 12000,
        speakerSource: 'diarization',
      });
      expect((await applied(meeting.id, result.undo)).segments).toEqual(before);
      const mixed = await applied(meeting.id, {
        kind: 'merge',
        segmentIds: before.slice(0, 2).map((s: SegmentDto) => s.id),
      });
      expect(mixed.segments[0]).toMatchObject({ speakerId: one.id, speakerSource: 'user' });
    });

    it('refuses lines that are not next to each other', async () => {
      const { meeting, a, c } = await fixture();
      const response = await edit(meeting.id, { kind: 'merge', segmentIds: [a.id, c.id] });
      expect(response.status).toBe(400);
      expect((await edit(meeting.id, { kind: 'merge', segmentIds: [a.id, a.id] })).status).toBe(
        400,
      );
    });
  });

  describe('revert', () => {
    it('restores the previous speaker of machine corrected lines only', async () => {
      const { meeting, one, two, a, b } = await fixture();
      await test.db
        .update(transcriptSegments)
        .set({ participantId: two.id, speakerSource: 'ai', previousParticipantId: one.id })
        .where(eq(transcriptSegments.id, a.id));
      const before = (await detail(meeting.id)).segments;
      const result = await applied(meeting.id, { kind: 'revert', segmentIds: [a.id, b.id] });
      expect(result.segments[0]).toMatchObject({
        speakerId: one.id,
        speakerSource: 'diarization',
        previousSpeaker: null,
      });
      expect(result.segments[1]).toEqual(before[1]);
      expect((await applied(meeting.id, result.undo)).segments).toEqual(before);
    });

    it('falls back to the indicator source outside recordings', async () => {
      const { meeting, one, two, a } = await fixture('meet');
      await test.db
        .update(transcriptSegments)
        .set({ participantId: two.id, speakerSource: 'guess', previousParticipantId: one.id })
        .where(eq(transcriptSegments.id, a.id));
      const result = await applied(meeting.id, { kind: 'revert', segmentIds: [a.id] });
      expect(result.segments[0]).toMatchObject({ speakerId: one.id, speakerSource: 'indicator' });
    });
  });

  describe('restore', () => {
    it('produces a redo, and refuses rows or lines of other meetings', async () => {
      const { meeting, two, a } = await fixture();
      const other = await fixture();
      const after = await applied(meeting.id, {
        kind: 'assign',
        segmentIds: [a.id],
        speaker: { id: two.id },
      });
      const undone = await applied(meeting.id, after.undo);
      const redone = await applied(meeting.id, undone.undo);
      expect(redone.segments).toEqual(after.segments);
      const [row] = after.undo.kind === 'restore' ? after.undo.rows : [];
      if (!row) throw new Error('no snapshot');
      const foreign: SpeakerEditInput[] = [
        {
          kind: 'restore',
          rows: [{ ...row, id: other.a.id }],
          removeIds: [],
          removeSpeakerIds: [],
        },
        { kind: 'restore', rows: [], removeIds: [other.a.id], removeSpeakerIds: [] },
        {
          kind: 'restore',
          rows: [{ ...row, speakerId: other.one.id }],
          removeIds: [],
          removeSpeakerIds: [],
        },
      ];
      for (const body of foreign) expect((await edit(meeting.id, body)).status).toBe(400);
    });

    it('only removes speakers of the meeting that have no lines left', async () => {
      const { meeting, one, two } = await fixture();
      const other = await fixture();
      const result = await applied(meeting.id, {
        kind: 'restore',
        rows: [],
        removeIds: [],
        removeSpeakerIds: [one.id, other.one.id],
      });
      expect(result.speakerChoices.map((choice) => choice.id)).toContain(one.id);
      expect(result.speakerChoices.map((choice) => choice.id)).toContain(two.id);
      const [kept] = await test.db
        .select()
        .from(participants)
        .where(eq(participants.id, other.one.id));
      expect(kept).toBeDefined();
    });
  });

  describe('speaker check', () => {
    it('refuses without a transcript, then marks the request and queues the review', async () => {
      const [empty] = await test.db
        .insert(meetings)
        .values({ title: 'Empty', platform: 'recording', joinUrl: '' })
        .returning();
      if (!empty) throw new Error('insert failed');
      expect((await call('POST', `/meetings/${empty.id}/speaker-check`)).status).toBe(409);

      const { meeting } = await fixture();
      await test.db
        .update(meetings)
        .set({ speakerCheckError: 'old failure' })
        .where(eq(meetings.id, meeting.id));
      sent.length = 0;
      const response = await call('POST', `/meetings/${meeting.id}/speaker-check`);
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ ok: true });
      expect(sent).toEqual([
        { name: 'meeting.review-speakers', payload: { meetingId: meeting.id } },
      ]);
      const body = await detail(meeting.id);
      expect(body.speakerCheck).toMatchObject({ running: true, checkedAt: null, error: null });
      expect((await call('POST', `/meetings/${missing}/speaker-check`)).status).toBe(404);
    });
  });
});
