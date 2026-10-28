import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore, type JobName, type JobPayloads } from '@openminutes/core';
import {
  audioFiles,
  eq,
  meetings,
  participants,
  people,
  roomVoices,
  sharedAccounts,
  transcriptSegments,
  voiceSamples,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { MeetingDetailDto, ParticipantsDto, PeopleDto, SharedAccountsDto } from '../dto.js';
import { assembleMinutes } from '../minutes/assemble.js';
import { recipientCandidates } from '../email/recipients.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('the people of a shared account', () => {
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
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-shared-'))),
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
  const roster = async (id: string) =>
    (await (await call('GET', `/meetings/${id}/participants`)).json()) as ParticipantsDto;

  /** Jo and Sam share one tile with an address of its own. */
  async function fixture(options: { audio?: boolean; tileName?: string } = {}) {
    const tileEmail = `${(options.tileName ?? 'Jo and Sam').toLowerCase().replace(/\W+/g, '-')}@example.com`;
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Planning',
        platform: 'meet',
        joinUrl: 'https://meet.example.com/abc',
        status: 'transcribed',
        invitees: [
          { email: tileEmail, name: 'Shared Room', declined: false },
          { email: 'jo@example.com', name: 'Jo Parker', declined: false },
          { email: 'sam@example.com', name: 'Sam Lee', declined: false },
        ],
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    if (options.audio !== false) {
      await test.db.insert(audioFiles).values({
        meetingId: meeting.id,
        path: 'none.opus',
        durationMs: 60_000,
        codec: 'opus',
        size: 1,
      });
    }
    const [tile] = await test.db
      .insert(participants)
      .values({
        meetingId: meeting.id,
        displayName: options.tileName ?? 'Jo and Sam',
        email: tileEmail,
        inviteeEmails: [tileEmail],
        roomAskedAt: new Date(),
      })
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
          lines: 3,
          durationMs: 15_000,
        },
        {
          meetingId: meeting.id,
          participantId: tile.id,
          number: 2,
          centroid: [0, 1],
          lines: 2,
          durationMs: 9_000,
        },
      ])
      .returning();
    if (!one || !two) throw new Error('insert failed');
    const plan: [string, string][] = [
      [one.id, 'We start with the budget'],
      [two.id, 'I will check the numbers'],
      [one.id, 'Agreed on the plan'],
      [two.id, 'Send me the sheet'],
      [one.id, 'Next week then'],
    ];
    await test.db.insert(transcriptSegments).values(
      plan.map(([roomVoiceId, text], i) => ({
        meetingId: meeting.id,
        participantId: tile.id,
        roomVoiceId,
        startMs: i * 6000,
        endMs: i * 6000 + 5000,
        text,
        speakerConfidence: 0.95,
        speakerSource: 'indicator' as const,
      })),
    );
    return { meeting, tile, one, two, tileEmail };
  }

  it('asks how many people, and not sure takes the detected number', async () => {
    const { meeting, tile } = await fixture();
    const before = await detail(meeting.id);
    expect(before.roomNotices).toMatchObject([{ participantId: tile.id, voices: 2 }]);
    // Nothing is split before the answer.
    expect((await roster(meeting.id)).participants).toHaveLength(1);

    const answered = await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, {
      unsure: true,
    });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ ok: true, splitting: false });
    expect((await detail(meeting.id)).roomNotices).toEqual([]);

    const list = await roster(meeting.id);
    // The sub-people sit under the tile and are not rows of their own.
    expect(list.participants.map((p) => p.name)).toEqual(['Jo and Sam']);
    const room = list.participants[0]?.room;
    expect(room).toMatchObject({ count: 2, detected: 2, canSplit: true, hasAudio: true });
    expect(room?.subs.map((s) => [s.name, s.unnamed, s.lines])).toEqual([
      ['Voice 1 (Jo and Sam)', true, 3],
      ['Voice 2 (Jo and Sam)', true, 2],
    ]);
    // Never the address of the tile.
    for (const sub of room?.subs ?? []) {
      expect(sub.emails).toEqual([]);
      expect(sub.email).toBeNull();
      expect(sub.inviteeEmails).toEqual([]);
    }
    const lines = (await detail(meeting.id)).segments;
    expect(lines.map((l) => l.speaker)).toEqual([
      'Voice 1 (Jo and Sam)',
      'Voice 2 (Jo and Sam)',
      'Voice 1 (Jo and Sam)',
      'Voice 2 (Jo and Sam)',
      'Voice 1 (Jo and Sam)',
    ]);
    expect(lines.every((l) => l.viaSpeaker === 'Jo and Sam')).toBe(true);
  });

  it('shows every sub-person on the People tab, unnamed, without clutter in the default filters', async () => {
    const { meeting, tile } = await fixture({ tileName: 'Ann and Sam' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { count: 2 });
    const all = (await (await call('GET', '/people')).json()) as PeopleDto;
    const mine = all.people.filter((p) => p.sharedAccount === 'Ann and Sam');
    expect(mine.map((p) => p.name).toSorted()).toEqual([
      'Voice 1 (Ann and Sam)',
      'Voice 2 (Ann and Sam)',
    ]);
    expect(mine.every((p) => p.unnamed && p.source === 'joined' && p.meetings === 1)).toBe(true);
    const unnamed = (await (await call('GET', '/people?source=unnamed')).json()) as PeopleDto;
    expect(unnamed.people.every((p) => p.unnamed)).toBe(true);
    expect(unnamed.people.length).toBeGreaterThanOrEqual(2);
    // They are not offered as duplicates of each other.
    expect(mine.every((p) => p.duplicates.length === 0)).toBe(true);
  });

  it('answers with a number: the same count is applied now, another one is a worker job', async () => {
    const { meeting, tile } = await fixture({ tileName: 'Two Ways' });
    sent.length = 0;
    const same = await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { count: 2 });
    expect(await same.json()).toEqual({ ok: true, splitting: false });
    expect(sent).toEqual([]);
    const [account] = await test.db
      .select()
      .from(sharedAccounts)
      .where(eq(sharedAccounts.key, 'email:two-ways@example.com'));
    expect(account?.count).toBe(2);

    const other = await fixture({ tileName: 'Three Ways' });
    const split = await call('POST', `/meetings/${other.meeting.id}/room/${other.tile.id}/count`, {
      count: 3,
    });
    expect(await split.json()).toEqual({ ok: true, splitting: true });
    expect(sent).toEqual([
      {
        name: 'meeting.split-room',
        payload: { meetingId: other.meeting.id, participantId: other.tile.id, count: 3 },
      },
    ]);
    const [asked] = await test.db
      .select()
      .from(participants)
      .where(eq(participants.id, other.tile.id));
    expect(asked?.roomCount).toBe(3);
    const room = (await roster(other.meeting.id)).participants[0]?.room;
    expect(room?.splitting).toBe(true);
  });

  it('asks for a manual split on a tile the detection did not flag', async () => {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Quiet', platform: 'meet', joinUrl: 'x', status: 'transcribed' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    await test.db
      .insert(audioFiles)
      .values({ meetingId: meeting.id, path: 'a.opus', durationMs: 1000, codec: 'opus', size: 1 });
    const [tile] = await test.db
      .insert(participants)
      .values({ meetingId: meeting.id, displayName: 'Plain Tile' })
      .returning();
    if (!tile) throw new Error('insert failed');
    expect((await roster(meeting.id)).participants[0]).toMatchObject({ canSplit: true });
    sent.length = 0;
    const res = await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { count: 2 });
    expect(await res.json()).toEqual({ ok: true, splitting: true });
    expect(sent[0]).toMatchObject({ name: 'meeting.split-room', payload: { count: 2 } });
  });

  it('refuses a bad count, a split without audio and a split of a named tile', async () => {
    const { meeting, tile } = await fixture({ audio: false });
    const url = `/meetings/${meeting.id}/room/${tile.id}/count`;
    expect((await call('POST', url, { count: 9 })).status).toBe(400);
    expect((await call('POST', url, { count: 'two' })).status).toBe(400);
    expect((await call('POST', url, { count: 3 })).status).toBe(409);
    const named = await fixture({ tileName: 'Named Tile' });
    await call('POST', `/meetings/${named.meeting.id}/room-voices/${named.one.id}/name`, {
      newName: 'Jo Parker',
    });
    const url2 = `/meetings/${named.meeting.id}/room/${named.tile.id}/count`;
    expect((await call('POST', url2, { count: 3 })).status).toBe(409);
  });

  it('names a voice from the parent card: the same person is renamed and linked', async () => {
    const { meeting, tile, one } = await fixture({ tileName: 'Naming Tile' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { unsure: true });
    const before = (await roster(meeting.id)).participants[0]?.room?.subs[0];
    const named = await call('POST', `/meetings/${meeting.id}/room-voices/${one.id}/name`, {
      newName: 'Jo Parkerson',
    });
    expect(named.status).toBe(200);
    const sub = (await roster(meeting.id)).participants[0]?.room?.subs.find(
      (s) => s.voiceId === one.id,
    );
    expect(sub).toMatchObject({ name: 'Jo Parkerson', unnamed: false, personId: before?.personId });
    const [person] = await test.db
      .select()
      .from(people)
      .where(eq(people.id, before?.personId ?? ''));
    expect(person).toMatchObject({ name: 'Jo Parkerson', unnamed: false });
    const lines = (await detail(meeting.id)).segments.filter((l) => l.speaker === 'Jo Parkerson');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ speakerSource: 'user', viaSpeaker: 'Naming Tile' });
    // The other voice is still unnamed.
    expect((await roster(meeting.id)).participants[0]?.room?.subs[1]?.unnamed).toBe(true);
  });

  it('naming from the People tab folds the voice into an existing person and keeps their samples', async () => {
    const [sam] = await test.db
      .insert(people)
      .values({ name: 'Sam Lee', emails: ['sam@example.com'] })
      .returning();
    if (!sam) throw new Error('insert failed');
    const { meeting, tile } = await fixture({ tileName: 'Merge Tile' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { unsure: true });
    const subs = (await roster(meeting.id)).participants[0]?.room?.subs ?? [];
    const second = subs[1];
    const other = subs[0];
    if (!second || !other) throw new Error('no subs');
    await test.db.insert(voiceSamples).values([
      { personId: second.personId, kind: 'imported', embedding: [0, 1] },
      { personId: other.personId, kind: 'imported', embedding: [1, 0] },
    ]);
    const res = await call('POST', `/people/${second.personId}/name-voice`, { personId: sam.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, personId: sam.id });
    // Sam has the voice of the second sub-person, the first one has only its own.
    const samples = await test.db
      .select()
      .from(voiceSamples)
      .where(eq(voiceSamples.personId, sam.id));
    expect(samples.map((s) => s.embedding)).toEqual([[0, 1]]);
    const left = await test.db
      .select()
      .from(voiceSamples)
      .where(eq(voiceSamples.personId, other.personId));
    expect(left.map((s) => s.embedding)).toEqual([[1, 0]]);
    expect((await detail(meeting.id)).segments.filter((l) => l.speaker === 'Sam Lee')).toHaveLength(
      2,
    );
    // Naming it twice is refused, and the voices point at the new person.
    expect((await call('POST', `/people/${sam.id}/name-voice`, { name: 'X' })).status).toBe(409);
    const voices = await test.db
      .select()
      .from(roomVoices)
      .where(eq(roomVoices.meetingId, meeting.id));
    expect(voices.map((v) => v.personId)).toContain(sam.id);
    // A typed name of someone who exists is the same as picking them.
    const typed = await call('POST', `/people/${other.personId}/name-voice`, { name: 'sam lee' });
    expect(typed.status).toBe(200);
    expect(((await typed.json()) as { personId: string }).personId).toBe(sam.id);
  });

  it('"It is one person" removes the sub rows, their people and gives the lines back', async () => {
    const { meeting, tile } = await fixture({ tileName: 'One Tile' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { unsure: true });
    expect((await roster(meeting.id)).participants[0]?.room?.subs).toHaveLength(2);
    const res = await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { count: 1 });
    expect(res.status).toBe(200);
    const list = await roster(meeting.id);
    expect(list.participants.map((p) => p.name)).toEqual(['One Tile']);
    expect(list.participants[0]?.room).toBeUndefined();
    expect((await detail(meeting.id)).segments.every((l) => l.speaker === 'One Tile')).toBe(true);
    const left = await test.db.select().from(people).where(eq(people.unnamed, true));
    expect(left.some((p) => p.name.includes('One Tile'))).toBe(false);
    // It is remembered: this account is one person now.
    const [account] = await test.db
      .select()
      .from(sharedAccounts)
      .where(eq(sharedAccounts.key, 'email:one-tile@example.com'));
    expect(account?.count).toBe(1);
  });

  it('lists the minutes attendees as the sub-people, never the tile or its address', async () => {
    const { meeting, tile, one } = await fixture({ tileName: 'Minutes Tile' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { unsure: true });
    const minutes = await assembleMinutes({ db: test.db, settings }, meeting.id);
    // Unnamed voices are listed under their placeholder names, without an address.
    expect(minutes?.attendees.map((a) => a.name).toSorted()).toEqual([
      'Voice 1 (Minutes Tile)',
      'Voice 2 (Minutes Tile)',
    ]);
    expect(minutes?.attendees.every((a) => a.email === null)).toBe(true);
    // The invitee behind the tile address is not shown as absent.
    expect(minutes?.absent.map((a) => a.email)).not.toContain('minutes-tile@example.com');
    await call('POST', `/meetings/${meeting.id}/room-voices/${one.id}/name`, {
      newName: 'Jo Parker',
    });
    const after = await assembleMinutes({ db: test.db, settings }, meeting.id);
    expect(after?.attendees.map((a) => a.name)).toContain('Jo Parker');
    expect(after?.attendees.map((a) => a.name)).not.toContain('Minutes Tile');
    const candidates = recipientCandidates(
      after ?? ({ attendees: [], absent: [] } as never),
      new Map(),
    );
    expect(candidates.map((c) => c.email)).not.toContain('minutes-tile@example.com');
  });

  it('gives each sub-person their own emails, an invitee to one only', async () => {
    const { meeting, tile, tileEmail } = await fixture({ tileName: 'Email Tile' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { unsure: true });
    const [a, b] = (await roster(meeting.id)).participants[0]?.room?.subs ?? [];
    if (!a || !b) throw new Error('no subs');
    const put = (sub: typeof a, body: object) =>
      call('PUT', `/meetings/${meeting.id}/participants/${sub.participantId}`, {
        name: sub.name,
        ...body,
      });
    expect((await put(a, { inviteeEmails: ['jo@example.com'] })).status).toBe(200);
    const clash = await put(b, { inviteeEmails: ['jo@example.com'] });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: string }).error).toContain(a.name);
    expect((await put(b, { inviteeEmails: ['sam@example.com'] })).status).toBe(200);
    // A typed address, validated, and the tile address to one of them only.
    expect((await put(b, { email: 'not-an-address' })).status).toBe(400);
    expect((await put(a, { email: tileEmail })).status).toBe(200);
    expect((await put(b, { email: tileEmail })).status).toBe(409);
    expect(
      (
        await call('PUT', `/meetings/${meeting.id}/participants/${a.participantId}/invitee`, {
          email: 'sam@example.com',
        })
      ).status,
    ).toBe(409);
    // A sub-person is named with Name, not by renaming the seat.
    expect(
      (
        await call('PUT', `/meetings/${meeting.id}/participants/${a.participantId}`, {
          name: 'Else',
        })
      ).status,
    ).toBe(409);
    const subs = (await roster(meeting.id)).participants[0]?.room?.subs ?? [];
    expect(subs.find((s) => s.voiceId === a.voiceId)).toMatchObject({
      inviteeEmails: ['jo@example.com'],
      email: tileEmail,
    });
    expect(subs.find((s) => s.voiceId === b.voiceId)?.inviteeEmails).toEqual(['sam@example.com']);
    // Each person got the address of their own, the tile's only where it was assigned.
    const owners = await test.db.select().from(people).where(eq(people.unnamed, true));
    const mine = owners.filter((p) => p.name.includes('Email Tile'));
    // sam@example.com belongs to the person Sam Lee (made in another test): an address has one
    // owner, so it stays with them and is not copied to a voice.
    expect(mine.flatMap((p) => p.emails).toSorted()).toEqual(
      [tileEmail, 'jo@example.com'].toSorted(),
    );
    const minutes = await assembleMinutes({ db: test.db, settings }, meeting.id);
    const recipients = recipientCandidates(
      minutes ?? ({ attendees: [], absent: [] } as never),
      new Map(),
    );
    expect(recipients.map((r) => [r.name, r.email]).toSorted()).toEqual([
      ['Voice 1 (Email Tile)', tileEmail],
      ['Voice 2 (Email Tile)', 'sam@example.com'],
    ]);
  });

  it('reads and changes the wait setting and forgets a remembered account', async () => {
    const start = (await (
      await call('GET', '/settings/shared-accounts')
    ).json()) as SharedAccountsDto;
    expect(start.waitMinutes).toBe(15);
    const saved = await call('PUT', '/settings/shared-accounts', { waitMinutes: 0 });
    expect(((await saved.json()) as SharedAccountsDto).waitMinutes).toBe(0);
    expect((await call('PUT', '/settings/shared-accounts', { waitMinutes: -1 })).status).toBe(400);
    expect((await call('PUT', '/settings/shared-accounts', { waitMinutes: 1.5 })).status).toBe(400);
    await call('PUT', '/settings/shared-accounts', { waitMinutes: 15 });
    const { meeting, tile } = await fixture({ tileName: 'Forget Tile' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { count: 2 });
    const listed = (await (
      await call('GET', '/settings/shared-accounts')
    ).json()) as SharedAccountsDto;
    const mine = listed.accounts.find((a) => a.label === 'Forget Tile');
    expect(mine).toMatchObject({ count: 2 });
    expect(mine?.voices).toHaveLength(2);
    const gone = await call('DELETE', `/settings/shared-accounts/${mine?.id}`);
    expect(
      ((await gone.json()) as SharedAccountsDto).accounts.some((a) => a.label === 'Forget Tile'),
    ).toBe(false);
    expect((await call('DELETE', `/settings/shared-accounts/${meeting.id}`)).status).toBe(404);
  });

  it('shows the wait in the question while the summary waits', async () => {
    const { meeting } = await fixture({ tileName: 'Wait Tile' });
    const notice = (await detail(meeting.id)).roomNotices[0];
    expect(notice?.waitsUntil).not.toBeNull();
    await call('PUT', '/settings/shared-accounts', { waitMinutes: 0 });
    expect((await detail(meeting.id)).roomNotices[0]?.waitsUntil).toBeNull();
    await call('PUT', '/settings/shared-accounts', { waitMinutes: 15 });
  });

  it('folds the two seats into one when a voice is named as someone already in the meeting', async () => {
    const [kim] = await test.db.insert(people).values({ name: 'Kim Seated' }).returning();
    if (!kim) throw new Error('insert failed');
    const { meeting, tile, one } = await fixture({ tileName: 'Fold Tile' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { unsure: true });
    const [kimSeat] = await test.db
      .insert(participants)
      .values({
        meetingId: meeting.id,
        displayName: 'Kim Seated',
        personId: kim.id,
        nameConfirmed: true,
      })
      .returning();
    await test.db.insert(transcriptSegments).values({
      meetingId: meeting.id,
      participantId: kimSeat?.id,
      startMs: 100_000,
      endMs: 103_000,
      text: 'Kim from her own laptop',
      speakerSource: 'indicator',
    });
    const res = await call('POST', `/meetings/${meeting.id}/room-voices/${one.id}/name`, {
      personId: kim.id,
    });
    expect(res.status).toBe(200);
    const seats = await test.db
      .select()
      .from(participants)
      .where(eq(participants.personId, kim.id));
    expect(seats.filter((s) => s.meetingId === meeting.id)).toHaveLength(1);
    const lines = (await detail(meeting.id)).segments.filter((l) => l.speaker === 'Kim Seated');
    expect(lines.map((l) => l.text).toSorted()).toEqual([
      'Agreed on the plan',
      'Kim from her own laptop',
      'Next week then',
      'We start with the budget',
    ]);
  });

  it('keeps the seat of a person who also has a voice as its own row, the voice shows its own lines', async () => {
    const [kim] = await test.db.insert(people).values({ name: 'Kim Both' }).returning();
    if (!kim) throw new Error('insert failed');
    const { meeting, tile, one } = await fixture({ tileName: 'Both Tile' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { unsure: true });
    const [seat] = await test.db
      .insert(participants)
      .values({ meetingId: meeting.id, displayName: 'Kim Both', personId: kim.id })
      .returning();
    await test.db.insert(transcriptSegments).values({
      meetingId: meeting.id,
      participantId: seat?.id,
      startMs: 100_000,
      endMs: 102_000,
      text: 'From her own laptop',
      speakerSource: 'indicator',
    });
    await call('POST', `/meetings/${meeting.id}/room-voices/${one.id}/name`, { personId: kim.id });
    const list = await roster(meeting.id);
    const own = list.participants.find((p) => p.name === 'Kim Both');
    expect(own).toMatchObject({ id: seat?.id, talkMs: 2000 });
    const voice = list.participants
      .find((p) => p.room)
      ?.room?.subs.find((s) => s.voiceId === one.id);
    expect(voice).toMatchObject({ lines: 3, talkMs: 15_000, seatSeparate: true });
  });

  it('lists a person who only exists for the voice once, with the voice lines', async () => {
    const { meeting, tile, one } = await fixture({ tileName: 'Once Tile' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { unsure: true });
    await call('POST', `/meetings/${meeting.id}/room-voices/${one.id}/name`, {
      newName: 'Pieter Once',
    });
    const list = await roster(meeting.id);
    expect(list.participants.map((p) => p.name)).toEqual(['Once Tile']);
    const voice = list.participants[0]?.room?.subs.find((s) => s.voiceId === one.id);
    expect(voice).toMatchObject({ name: 'Pieter Once', lines: 3, seatSeparate: false });
  });

  it('gives an invitee of a tile to one person only, however it is linked', async () => {
    const { meeting, tile } = await fixture({ tileName: 'Guard Tile' });
    await call('POST', `/meetings/${meeting.id}/room/${tile.id}/count`, { unsure: true });
    const [a, b] = (await roster(meeting.id)).participants[0]?.room?.subs ?? [];
    if (!a || !b) throw new Error('no subs');
    const put = (id: string, body: object) =>
      call('PUT', `/meetings/${meeting.id}/participants/${id}`, body);
    expect(
      (await put(a.participantId, { name: a.name, inviteeEmails: ['jo@example.com'] })).status,
    ).toBe(200);
    // A plain participant cannot take it, by renaming or by "They were there".
    const [plain] = await test.db
      .insert(participants)
      .values({ meetingId: meeting.id, displayName: 'Plain Pat' })
      .returning();
    if (!plain) throw new Error('insert failed');
    expect(
      (await put(plain.id, { name: 'Plain Pat', inviteeEmails: ['jo@example.com'] })).status,
    ).toBe(409);
    const link = (id: string, body: object) =>
      call('PUT', `/meetings/${meeting.id}/participants/${id}/invitee`, body);
    expect((await link(plain.id, { email: 'jo@example.com' })).status).toBe(409);
    const [stranger] = await test.db.insert(people).values({ name: 'Stranger Sue' }).returning();
    if (!stranger) throw new Error('insert failed');
    const viaPerson = (body: object) =>
      call('PUT', `/meetings/${meeting.id}/people/${stranger.id}/invitee`, body);
    expect((await viaPerson({ email: 'jo@example.com' })).status).toBe(409);
    // Moving takes it from the previous person, so it shows on one row only.
    expect((await viaPerson({ email: 'jo@example.com', move: true })).status).toBe(200);
    const subs = (await roster(meeting.id)).participants.find((p) => p.room)?.room?.subs ?? [];
    expect(subs.flatMap((s) => s.inviteeEmails)).not.toContain('jo@example.com');
    const holders = (await roster(meeting.id)).participants.filter((p) =>
      p.inviteeEmails.includes('jo@example.com'),
    );
    expect(holders.map((p) => p.name)).toEqual(['Stranger Sue']);
    // And between two people of the tile.
    expect(
      (await put(b.participantId, { name: b.name, inviteeEmails: ['sam@example.com'] })).status,
    ).toBe(200);
    expect(
      (await put(a.participantId, { name: a.name, inviteeEmails: ['sam@example.com'], move: true }))
        .status,
    ).toBe(200);
    const after = (await roster(meeting.id)).participants.find((p) => p.room)?.room?.subs ?? [];
    expect(after.find((s) => s.voiceId === b.voiceId)?.inviteeEmails).toEqual([]);
    expect(after.find((s) => s.voiceId === a.voiceId)?.inviteeEmails).toEqual(['sam@example.com']);
  });
});
