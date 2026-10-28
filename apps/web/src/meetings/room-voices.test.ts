import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore, type JobName, type JobPayloads } from '@openminutes/core';
import {
  eq,
  meetings,
  participants,
  people,
  roomVoices,
  transcriptSegments,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { MeetingDetailDto, RoomReviewDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('meeting rooms: several people in one participant tile', () => {
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
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-rooms-'))),
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
    (await (await call('GET', `/meetings/${id}`)).json()) as MeetingDetailDto;

  /** Voice 1 has four lines, voice 2 three, one line fits neither and one was set by the owner. */
  async function fixture() {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Board', platform: 'meet', joinUrl: '', status: 'transcribed' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const [room, rita] = await test.db
      .insert(participants)
      .values([
        { meetingId: meeting.id, displayName: 'Meeting room' },
        { meetingId: meeting.id, displayName: 'Remote Rita', nameConfirmed: true },
      ])
      .returning();
    if (!room || !rita) throw new Error('insert failed');
    const [one, two] = await test.db
      .insert(roomVoices)
      .values([
        {
          meetingId: meeting.id,
          participantId: room.id,
          number: 1,
          centroid: [1, 0],
          lines: 4,
          durationMs: 20_000,
        },
        {
          meetingId: meeting.id,
          participantId: room.id,
          number: 2,
          centroid: [0, 1],
          lines: 3,
          durationMs: 15_000,
        },
      ])
      .returning();
    if (!one || !two) throw new Error('insert failed');
    const plan: [string | null, string | null, string, Partial<{ source: 'user'; by: string }>?][] =
      [
        [one.id, room.id, 'One a'],
        [one.id, room.id, 'One b'],
        [one.id, room.id, 'One c'],
        [two.id, room.id, 'Two a'],
        [two.id, room.id, 'Two b'],
        [null, room.id, 'Both talk at once'],
        [one.id, rita.id, 'Edited by the owner', { source: 'user' }],
      ];
    const rows = await test.db
      .insert(transcriptSegments)
      .values(
        plan.map(([roomVoiceId, participantId, text, extra], i) => ({
          meetingId: meeting.id,
          participantId,
          roomVoiceId,
          startMs: i * 6000,
          endMs: i * 6000 + 5000,
          text,
          speakerConfidence: 0.95,
          speakerSource: extra?.source ?? ('indicator' as const),
        })),
      )
      .returning();
    return { meeting, room, rita, one, two, rows };
  }

  const lineOf = async (rows: { id: string; text: string }[], text: string) => {
    const id = rows.find((r) => r.text === text)?.id ?? '';
    const [row] = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.id, id));
    if (!row) throw new Error(`no line ${text}`);
    return row;
  };

  it('shows a quiet notice and the voices with a few lines to listen to', async () => {
    const { meeting, room } = await fixture();
    expect((await detail(meeting.id)).roomNotices).toEqual([
      {
        participantId: room.id,
        name: 'Meeting room',
        voices: 2,
        unnamed: 2,
        waitsUntil: null,
      },
    ]);
    const review = (await (
      await call('GET', `/meetings/${meeting.id}/room/${room.id}`)
    ).json()) as RoomReviewDto;
    expect(review.voices.map((v) => [v.number, v.lines, v.personName])).toEqual([
      [1, 4, null],
      [2, 2, null],
    ]);
    expect(review.voices[0]?.snippets.length).toBeGreaterThan(0);
    expect(review.roster.map((r) => r.name)).toEqual(['Remote Rita']);
    expect((await call('GET', `/meetings/${meeting.id}/room/${meeting.id}`)).status).toBe(404);
  });

  it('changes no label until a voice is named', async () => {
    const { meeting, room, rows } = await fixture();
    const segments = (await detail(meeting.id)).segments;
    expect(segments.filter((s) => s.speakerId === room.id)).toHaveLength(6);
    expect(segments.every((s) => s.viaSpeaker === null)).toBe(true);
    expect((await lineOf(rows, 'One a')).speakerSource).toBe('indicator');
  });

  it('names a voice: its lines carry the person, listen via the tile, edits stay', async () => {
    const [anna] = await test.db.insert(people).values({ name: 'Anna Room' }).returning();
    if (!anna) throw new Error('insert failed');
    const { meeting, room, rita, one, rows } = await fixture();
    sent.length = 0;
    await settings.set('voices.remember', 'true');
    const named = await call('POST', `/meetings/${meeting.id}/room-voices/${one.id}/name`, {
      personId: anna.id,
    });
    expect(named.status).toBe(200);

    const after = await detail(meeting.id);
    const byText = (text: string) => after.segments.find((s) => s.text === text);
    expect(byText('One a')).toMatchObject({ speaker: 'Anna Room', viaSpeaker: 'Meeting room' });
    expect(byText('One a')?.speakerSource).toBe('user');
    // The owner's edit is untouched.
    // The other voice is a person of its own now, still without a name.
    expect(byText('Two a')).toMatchObject({
      speaker: 'Voice 2 (Meeting room)',
      viaSpeaker: 'Meeting room',
    });
    expect(byText('Edited by the owner')).toMatchObject({
      speaker: 'Remote Rita',
      viaSpeaker: null,
    });
    expect((await lineOf(rows, 'Edited by the owner')).participantId).toBe(rita.id);
    // The line that fits no voice goes to review.
    expect((await lineOf(rows, 'Both talk at once')).speakerConfidence).toBeLessThan(0.7);
    expect(byText('Both talk at once')?.uncertain).toBe(true);
    // Each voice teaches the person, through the same job as a verified line.
    const learn = sent.find((s) => s.name === 'meeting.learn-voice');
    expect(learn?.payload).toMatchObject({ meetingId: meeting.id });
    expect((learn?.payload as { segmentIds: string[] }).segmentIds).toHaveLength(3);
    // The number of people is known now, so the question is gone.
    expect(after.roomNotices).toEqual([]);
    expect(room.id).toBeTruthy();
    expect(
      (
        await call('POST', `/meetings/${meeting.id}/room-voices/${one.id}/name`, {
          personId: anna.id,
        })
      ).status,
    ).toBe(409);
    await settings.set('voices.remember', 'false');
  });

  it('creates a new person and does not queue learning while voice learning is off', async () => {
    const { meeting, two } = await fixture();
    await settings.set('voices.remember', 'false');
    sent.length = 0;
    const named = await call('POST', `/meetings/${meeting.id}/room-voices/${two.id}/name`, {
      newName: 'Bram Newcomer',
    });
    expect(named.status).toBe(200);
    expect(
      await test.db.select().from(people).where(eq(people.name, 'Bram Newcomer')),
    ).toHaveLength(1);
    expect(sent.some((s) => s.name === 'meeting.learn-voice')).toBe(false);
    expect((await detail(meeting.id)).segments.find((s) => s.text === 'Two a')?.speaker).toBe(
      'Bram Newcomer',
    );
  });

  it('rejects a bad name request', async () => {
    const { meeting, one } = await fixture();
    expect(
      (await call('POST', `/meetings/${meeting.id}/room-voices/${one.id}/name`, {})).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/meetings/${meeting.id}/room-voices/${meeting.id}/name`, {
          newName: 'X',
        })
      ).status,
    ).toBe(404);
  });

  it('remembers "It is one person" and drops the voices', async () => {
    const { meeting, room, rows } = await fixture();
    const dismissed = await call('POST', `/meetings/${meeting.id}/room/${room.id}/dismiss`);
    expect(dismissed.status).toBe(200);
    expect((await detail(meeting.id)).roomNotices).toEqual([]);
    expect(
      await test.db.select().from(roomVoices).where(eq(roomVoices.meetingId, meeting.id)),
    ).toEqual([]);
    const [tile] = await test.db.select().from(participants).where(eq(participants.id, room.id));
    expect(tile?.roomDismissedAt).not.toBeNull();
    expect((await lineOf(rows, 'One a')).roomVoiceId).toBeNull();
    expect((await call('GET', `/meetings/${meeting.id}/room/${room.id}`)).status).toBe(404);
  });

  it('does not dismiss a tile that has a named voice', async () => {
    const { meeting, room, one } = await fixture();
    await call('POST', `/meetings/${meeting.id}/room-voices/${one.id}/name`, {
      newName: 'Cleo Named',
    });
    expect((await call('POST', `/meetings/${meeting.id}/room/${room.id}/dismiss`)).status).toBe(
      409,
    );
  });

  it('forgets the voices of a tile with the voice data', async () => {
    const { meeting } = await fixture();
    const { forgetVoices } = await import('@openminutes/core');
    await forgetVoices(test.db);
    expect(
      await test.db.select().from(roomVoices).where(eq(roomVoices.meetingId, meeting.id)),
    ).toEqual([]);
  });
});
