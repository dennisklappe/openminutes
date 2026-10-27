import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { addVoiceSamples, LocalStorage, SettingsStore } from '@openminutes/core';
import {
  and,
  eq,
  meetings,
  participants,
  people,
  roomVoices,
  sharedAccountVoices,
  transcriptSegments,
  voiceSamples,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { ParticipantsDto, RoomChangePreviewDto, RoomReviewDto, SubPersonDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('changing who a named voice of a shared account is', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let cookie = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-change-'))),
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
  beforeEach(async () => {
    // An address has one owner: each test starts without the ones earlier tests gave out.
    await test.db.update(people).set({ emails: [] });
  });

  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...json, cookie },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const roster = async (id: string) =>
    (await (await call('GET', `/meetings/${id}/participants`)).json()) as ParticipantsDto;

  let counter = 0;
  /**
   * A tile with two voices that are people already (the count is known). Voice 1 has three
   * lines and one the owner set by hand, voice 2 has one line. Anna Synthetic has a sample from
   * another meeting.
   */
  async function fixture() {
    counter += 1;
    const tileName = `Tile ${String(counter)}`;
    const [meeting, elsewhere] = await test.db
      .insert(meetings)
      .values([
        {
          title: 'Planning',
          platform: 'meet',
          joinUrl: 'https://meet.example.com/abc',
          status: 'transcribed',
          invitees: [
            { email: 'bart@example.com', name: 'Bart Fixture', declined: false },
            { email: 'pieter@example.com', name: 'Pieter Fixture', declined: false },
          ],
        },
        { title: 'Other', platform: 'meet', joinUrl: '', status: 'transcribed' },
      ])
      .returning();
    if (!meeting || !elsewhere) throw new Error('insert failed');
    const [tile] = await test.db
      .insert(participants)
      .values({ meetingId: meeting.id, displayName: tileName, roomCount: 2 })
      .returning();
    if (!tile) throw new Error('insert failed');
    const [one, two] = await test.db
      .insert(roomVoices)
      .values([
        {
          meetingId: meeting.id,
          participantId: tile.id,
          number: 1,
          centroid: [1, 0],
          lines: 4,
          durationMs: 20_000,
        },
        {
          meetingId: meeting.id,
          participantId: tile.id,
          number: 2,
          centroid: [0, 1],
          lines: 1,
          durationMs: 5_000,
        },
      ])
      .returning();
    if (!one || !two) throw new Error('insert failed');
    const plan: [string, string, 'user' | 'indicator'][] = [
      [one.id, 'One a', 'indicator'],
      [one.id, 'One b', 'indicator'],
      [one.id, 'One c', 'indicator'],
      [one.id, 'One by hand', 'user'],
      [two.id, 'Two a', 'indicator'],
    ];
    const rows = await test.db
      .insert(transcriptSegments)
      .values(
        plan.map(([roomVoiceId, text, speakerSource], i) => ({
          meetingId: meeting.id,
          participantId: tile.id,
          roomVoiceId,
          startMs: i * 6000,
          endMs: i * 6000 + 5000,
          text,
          speakerConfidence: 0.95,
          speakerSource,
        })),
      )
      .returning();
    const { applyRoomVoices } = await import('@openminutes/core');
    await applyRoomVoices(test.db, meeting.id, tile.id);
    const subs = (await roster(meeting.id)).participants[0]?.room?.subs ?? [];
    const sub1 = subs.find((s) => s.number === 1) as SubPersonDto;
    const sub2 = subs.find((s) => s.number === 2) as SubPersonDto;
    return { meeting, elsewhere, tile, one, two, rows, sub1, sub2, tileName };
  }

  const person = async (name: string, emails: string[] = []) => {
    const [row] = await test.db.insert(people).values({ name, emails }).returning();
    if (!row) throw new Error('insert failed');
    return row;
  };
  const reload = async (id: string) => {
    const [row] = await test.db.select().from(people).where(eq(people.id, id));
    if (!row) throw new Error('person is gone');
    return row;
  };
  const lines = async (meetingId: string) =>
    test.db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, meetingId));
  const seatOfPerson = async (meetingId: string, personId: string) =>
    (
      await test.db
        .select()
        .from(participants)
        .where(and(eq(participants.meetingId, meetingId), eq(participants.personId, personId)))
    )[0];
  const name = (meetingId: string, voiceId: string, body: object) =>
    call('POST', `/meetings/${meetingId}/room-voices/${voiceId}/name`, body);
  const change = (meetingId: string, voiceId: string, body: object) =>
    call('POST', `/meetings/${meetingId}/room-voices/${voiceId}/change`, body);
  const preview = async (meetingId: string, voiceId: string) =>
    (await (
      await call('GET', `/meetings/${meetingId}/room-voices/${voiceId}/change`)
    ).json()) as RoomChangePreviewDto;

  /** Names voice 1 as the person and adds the samples the voice learning would have added. */
  async function named(f: Awaited<ReturnType<typeof fixture>>, who: { id: string }, body: object) {
    expect((await name(f.meeting.id, f.sub1.voiceId, body)).status).toBe(200);
    const mine = (await lines(f.meeting.id)).filter(
      (l) => l.roomVoiceId === f.one.id && l.text !== 'One by hand',
    );
    await addVoiceSamples(
      test.db,
      who.id,
      mine.map((l) => ({
        kind: 'line' as const,
        embedding: [1, 0],
        meetingId: f.meeting.id,
        segmentId: l.id,
      })),
    );
    return mine;
  }

  it('moves the lines and samples to another person and builds the previous profile again', async () => {
    const f = await fixture();
    const anna = await person('Anna Synthetic', ['anna@example.com']);
    const bea = await person('Bea Synthetic');
    await addVoiceSamples(test.db, anna.id, [
      { kind: 'meeting', embedding: [0, 1], meetingId: f.elsewhere.id },
    ]);
    const mine = await named(f, anna, {
      personId: anna.id,
      inviteeEmails: ['bart@example.com'],
    });
    const before = await reload(anna.id);
    expect(before.voicePrototypes.map((p) => p.vector)).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(before.emails).toContain('bart@example.com');

    const shown = await preview(f.meeting.id, f.sub1.voiceId);
    expect(shown).toMatchObject({
      personName: 'Anna Synthetic',
      lines: 3,
      keptLines: 1,
      samples: 3,
    });
    expect(shown.emails).toEqual([
      { email: 'bart@example.com', onPerson: true, onSeat: true, suggested: true },
    ]);

    const res = await change(f.meeting.id, f.sub1.voiceId, {
      personId: bea.id,
      removeEmails: ['bart@example.com'],
    });
    expect(res.status).toBe(200);

    // The lines carry Bea as verified lines, the one set by hand stays.
    const beaSeat = await seatOfPerson(f.meeting.id, bea.id);
    const now = await lines(f.meeting.id);
    for (const line of mine) {
      expect(now.find((l) => l.id === line.id)).toMatchObject({
        participantId: beaSeat?.id,
        speakerSource: 'user',
      });
    }
    const byHand = now.find((l) => l.text === 'One by hand');
    expect(byHand?.speakerSource).toBe('user');
    expect(byHand?.participantId).toBe(f.tile.id);
    // Anna keeps only the sample of the other meeting and her profile is built from it alone.
    const samples = await test.db
      .select()
      .from(voiceSamples)
      .where(eq(voiceSamples.personId, anna.id));
    expect(samples.map((s) => s.meetingId)).toEqual([f.elsewhere.id]);
    expect((await reload(anna.id)).voicePrototypes.map((p) => p.vector)).toEqual([[0, 1]]);
    // The address that came with this meeting is off Anna, her own stays.
    expect((await reload(anna.id)).emails).toEqual(['anna@example.com']);
    expect(await seatOfPerson(f.meeting.id, anna.id)).toBeUndefined();
    const [voice] = await test.db.select().from(roomVoices).where(eq(roomVoices.id, f.one.id));
    expect(voice?.personId).toBe(bea.id);
    expect(samples.some((s) => s.segmentId && mine.some((l) => l.id === s.segmentId))).toBe(false);
  });

  it('puts a voice back to unnamed and leaves the profile without this meeting', async () => {
    const f = await fixture();
    const anna = await person('Anna Two');
    await named(f, anna, { personId: anna.id });
    const res = await change(f.meeting.id, f.sub1.voiceId, { unnamed: true });
    expect(res.status).toBe(200);
    const [voice] = await test.db.select().from(roomVoices).where(eq(roomVoices.id, f.one.id));
    const owner = await reload(voice?.personId ?? '');
    expect(owner).toMatchObject({ unnamed: true, name: `Voice 1 (${f.tileName})` });
    const seat = await seatOfPerson(f.meeting.id, owner.id);
    const now = await lines(f.meeting.id);
    expect(now.filter((l) => l.roomVoiceId === f.one.id && l.text !== 'One by hand')).toSatisfy(
      (rows: typeof now) =>
        rows.every((l) => l.participantId === seat?.id && l.speakerSource === 'diarization'),
    );
    // The account remembers voice 1 as the placeholder again, not as Anna.
    const slots = await test.db
      .select()
      .from(sharedAccountVoices)
      .where(eq(sharedAccountVoices.personId, owner.id));
    expect(slots).toHaveLength(1);
    expect(
      await test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, anna.id)),
    ).toEqual([]);
    expect((await reload(anna.id)).voicePrototypes).toEqual([]);
    // Voice 2 was not touched, and the voice can be named again.
    const room = (await roster(f.meeting.id)).participants[0]?.room;
    expect(room?.subs.find((s) => s.number === 1)?.unnamed).toBe(true);
    expect((await name(f.meeting.id, f.sub1.voiceId, { newName: 'Cleo Synthetic' })).status).toBe(
      200,
    );
  });

  it('removes a person that was made for the voice only, and refuses what makes no sense', async () => {
    const f = await fixture();
    expect((await change(f.meeting.id, f.sub1.voiceId, { unnamed: true })).status).toBe(409);
    expect((await name(f.meeting.id, f.sub1.voiceId, { newName: 'Pieter Synthetic' })).status).toBe(
      200,
    );
    const pieter = (
      await test.db.select().from(people).where(eq(people.name, 'Pieter Synthetic'))
    )[0];
    if (!pieter) throw new Error('not made');
    expect(
      (await change(f.meeting.id, f.sub1.voiceId, { newName: 'pieter synthetic' })).status,
    ).toBe(400);
    expect((await change(f.meeting.id, f.sub1.voiceId, { personId: pieter.id })).status).toBe(400);
    expect(
      (
        await change(f.meeting.id, f.sub1.voiceId, {
          unnamed: true,
          removeEmails: ['stranger@example.com'],
        })
      ).status,
    ).toBe(400);
    expect(
      (await change(f.meeting.id, f.sub1.voiceId, { personId: crypto.randomUUID() })).status,
    ).toBe(404);
    const bea = await person('Bea Three');
    expect((await change(f.meeting.id, f.sub1.voiceId, { personId: bea.id })).status).toBe(200);
    expect(await test.db.select().from(people).where(eq(people.id, pieter.id))).toEqual([]);
    const review = (await (
      await call('GET', `/meetings/${f.meeting.id}/room/${f.tile.id}`)
    ).json()) as RoomReviewDto;
    expect(review.voices.find((v) => v.number === 1)?.personName).toBe('Bea Three');
  });

  it('suggests the addresses of a seat that existed for this voice only', async () => {
    const f = await fixture();
    const anna = await person('Anna Four');
    await named(f, anna, { personId: anna.id, inviteeEmails: ['pieter@example.com'] });
    // The line set by hand sits on the seat, so it is in use: nothing is suggested to remove.
    const annaSeat = await seatOfPerson(f.meeting.id, anna.id);
    await test.db
      .update(transcriptSegments)
      .set({ participantId: annaSeat?.id ?? null })
      .where(
        and(
          eq(transcriptSegments.meetingId, f.meeting.id),
          eq(transcriptSegments.text, 'One by hand'),
        ),
      );
    expect((await preview(f.meeting.id, f.sub1.voiceId)).emails.map((e) => e.suggested)).toEqual([
      false,
    ]);
    await test.db
      .update(transcriptSegments)
      .set({ roomVoiceId: null, participantId: f.tile.id })
      .where(
        and(
          eq(transcriptSegments.meetingId, f.meeting.id),
          eq(transcriptSegments.text, 'One by hand'),
        ),
      );
    expect((await preview(f.meeting.id, f.sub1.voiceId)).emails.map((e) => e.suggested)).toEqual([
      true,
    ]);
    const res = await change(f.meeting.id, f.sub1.voiceId, {
      unnamed: true,
      removeEmails: ['pieter@example.com'],
    });
    expect(res.status).toBe(200);
    expect(await seatOfPerson(f.meeting.id, anna.id)).toBeUndefined();
    expect((await reload(anna.id)).emails).toEqual([]);
    // Without ticking the address Anna keeps it.
    const g = await fixture();
    const cleo = await person('Cleo Four');
    await named(g, cleo, { personId: cleo.id, inviteeEmails: ['bart@example.com'] });
    expect((await change(g.meeting.id, g.sub1.voiceId, { unnamed: true })).status).toBe(200);
    expect((await reload(cleo.id)).emails).toContain('bart@example.com');
  });

  it('attaches the emails chosen while naming to that person only', async () => {
    const f = await fixture();
    const res = await name(f.meeting.id, f.sub1.voiceId, {
      newName: 'Dana Synthetic',
      inviteeEmails: ['bart@example.com'],
      email: 'dana.typed@example.com',
    });
    expect(res.status).toBe(200);
    const dana = (await test.db.select().from(people).where(eq(people.name, 'Dana Synthetic')))[0];
    expect(dana?.emails.toSorted()).toEqual(['bart@example.com', 'dana.typed@example.com']);
    const seat = await seatOfPerson(f.meeting.id, dana?.id ?? '');
    expect(seat).toMatchObject({
      inviteeEmails: ['bart@example.com'],
      email: 'dana.typed@example.com',
    });
    const [tile] = await test.db.select().from(participants).where(eq(participants.id, f.tile.id));
    expect(tile?.inviteeEmails).toEqual([]);
    // The same invitee for the other voice is refused, unless it is moved.
    const clash = await name(f.meeting.id, f.sub2.voiceId, {
      newName: 'Eli Synthetic',
      inviteeEmails: ['bart@example.com'],
    });
    expect(clash.status).toBe(409);
    expect(await test.db.select().from(people).where(eq(people.name, 'Eli Synthetic'))).toEqual([]);
    const moved = await name(f.meeting.id, f.sub2.voiceId, {
      newName: 'Eli Synthetic',
      inviteeEmails: ['bart@example.com'],
      move: true,
    });
    expect(moved.status).toBe(200);
    expect((await seatOfPerson(f.meeting.id, dana?.id ?? ''))?.inviteeEmails).toEqual([]);
    expect((await reload(dana?.id ?? '')).emails).toEqual(['dana.typed@example.com']);
    // Not an invitee, not an address.
    const bad = await name(f.meeting.id, f.sub1.voiceId, {
      newName: 'X',
      inviteeEmails: ['nobody@example.com'],
    });
    expect(bad.status).toBe(409);
    const fresh = await fixture();
    expect(
      (
        await name(fresh.meeting.id, fresh.sub1.voiceId, {
          newName: 'Fay Synthetic',
          inviteeEmails: ['nobody@example.com'],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await name(fresh.meeting.id, fresh.sub1.voiceId, {
          newName: 'Fay Synthetic',
          email: 'nope',
        })
      ).status,
    ).toBe(400);
  });

  it('lists the choices of a person with their emails and takes an invitee from the Unable to attend list', async () => {
    const f = await fixture();
    const gus = await person('Gus Synthetic', ['gus@example.com']);
    const review = (await (
      await call('GET', `/meetings/${f.meeting.id}/room/${f.tile.id}`)
    ).json()) as RoomReviewDto;
    expect(review.people.find((p) => p.id === gus.id)?.emails).toEqual(['gus@example.com']);
    // Both invitees are listed as absent, and can be linked to a sub-person of the tile.
    expect((await roster(f.meeting.id)).absent.map((i) => i.email).toSorted()).toEqual([
      'bart@example.com',
      'pieter@example.com',
    ]);
    const link = (seat: string, body: object) =>
      call('PUT', `/meetings/${f.meeting.id}/participants/${seat}/invitee`, body);
    expect((await link(f.sub1.participantId, { email: 'bart@example.com' })).status).toBe(200);
    expect((await link(f.sub2.participantId, { email: 'bart@example.com' })).status).toBe(409);
    expect(
      (await link(f.sub2.participantId, { email: 'bart@example.com', move: true })).status,
    ).toBe(200);
    const subs = (await roster(f.meeting.id)).participants[0]?.room?.subs ?? [];
    expect(subs.find((s) => s.number === 1)?.inviteeEmails).toEqual([]);
    expect(subs.find((s) => s.number === 2)?.inviteeEmails).toEqual(['bart@example.com']);
    // Someone from People who has no seat here gets one with the invitee.
    const put = await call('PUT', `/meetings/${f.meeting.id}/people/${gus.id}/invitee`, {
      email: 'pieter@example.com',
    });
    expect(put.status).toBe(200);
    expect((await seatOfPerson(f.meeting.id, gus.id))?.inviteeEmails).toEqual([
      'pieter@example.com',
    ]);
    expect((await roster(f.meeting.id)).absent).toEqual([]);
    expect(
      (
        await call('PUT', `/meetings/${f.meeting.id}/people/${gus.id}/invitee`, {
          email: 'nobody@example.com',
        })
      ).status,
    ).toBe(400);
    // Taking an invitee from a normal participant needs the move too.
    const moving = await link(f.sub1.participantId, { email: 'pieter@example.com' });
    expect(moving.status).toBe(409);
  });
});
