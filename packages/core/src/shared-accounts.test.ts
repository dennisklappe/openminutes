import {
  eq,
  meetings,
  participants,
  people,
  roomVoices,
  sharedAccountVoices,
  transcriptSegments,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountKey,
  applyRoomVoices,
  ensureAccount,
  forgetAccount,
  isSharedTile,
  listRememberedAccounts,
  openRoomQuestions,
  rememberCount,
  rememberedCount,
  resetRoomVoices,
  settleRoomQuestions,
  summaryWait,
  waitMinutes,
} from './shared-accounts.js';
import { linkMeetingPeople } from './people-sync.js';

describe('shared account keys and waiting', () => {
  it('keys a tile by its email, else by its normalised name', () => {
    expect(accountKey({ email: ' Room@Example.com ', displayName: 'Jo and Sam' })).toBe(
      'email:room@example.com',
    );
    expect(accountKey({ email: null, displayName: '  Jo   and  Sam ' })).toBe('name:jo and sam');
    expect(accountKey({ email: '', displayName: 'JO AND SAM' })).toBe('name:jo and sam');
  });

  it('reads the wait setting, 0 meaning never wait', () => {
    expect(waitMinutes(undefined)).toBe(15);
    expect(waitMinutes('0')).toBe(0);
    expect(waitMinutes('30')).toBe(30);
    expect(waitMinutes('-4')).toBe(15);
    expect(waitMinutes('abc')).toBe(15);
  });

  it('waits only while the time since the question is under the limit', () => {
    const asked = new Date('2026-10-27T10:00:00Z');
    const q = [{ participantId: 'a', name: 'Room', voices: 2, askedAt: asked, splitting: false }];
    const at = (minutes: number) => new Date(asked.getTime() + minutes * 60_000);
    expect(summaryWait(q, 15, at(5))?.until).toEqual(at(15));
    expect(summaryWait(q, 15, at(15))).toBeUndefined();
    expect(summaryWait(q, 15, at(40))).toBeUndefined();
    expect(summaryWait(q, 0, at(0))).toBeUndefined();
    expect(summaryWait([], 15, at(0))).toBeUndefined();
  });
});

describe('voices of a shared account become people', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  async function room(email: string | null = 'room@example.com') {
    const [m] = await test.db
      .insert(meetings)
      .values({ title: 'Planning', platform: 'meet', joinUrl: 'https://meet.example.com/x' })
      .returning();
    const meetingId = m?.id ?? '';
    const [tile] = await test.db
      .insert(participants)
      .values({ meetingId, displayName: 'Jo and Sam', email, voiceEmbedding: [1, 1] })
      .returning();
    const tileId = tile?.id ?? '';
    const voices = await test.db
      .insert(roomVoices)
      .values([
        {
          meetingId,
          participantId: tileId,
          number: 1,
          centroid: [1, 0],
          lines: 3,
          durationMs: 9000,
        },
        {
          meetingId,
          participantId: tileId,
          number: 2,
          centroid: [0, 1],
          lines: 2,
          durationMs: 6000,
        },
      ])
      .returning();
    const [v1, v2] = voices.toSorted((a, b) => a.number - b.number);
    const lines = await test.db
      .insert(transcriptSegments)
      .values([
        {
          meetingId,
          participantId: tileId,
          roomVoiceId: v1?.id,
          startMs: 0,
          endMs: 3000,
          text: 'one',
          speakerSource: 'indicator',
          speakerConfidence: 0.95,
        },
        {
          meetingId,
          participantId: tileId,
          roomVoiceId: v2?.id,
          startMs: 4000,
          endMs: 7000,
          text: 'two',
          speakerSource: 'indicator',
          speakerConfidence: 0.95,
        },
        {
          meetingId,
          participantId: tileId,
          roomVoiceId: v2?.id,
          startMs: 8000,
          endMs: 9000,
          text: 'mine',
          speakerSource: 'user',
          speakerConfidence: 1,
        },
        {
          meetingId,
          participantId: tileId,
          roomVoiceId: null,
          startMs: 10000,
          endMs: 11000,
          text: 'loose',
          speakerSource: 'indicator',
          speakerConfidence: 0.95,
        },
      ])
      .returning();
    if (!tile) throw new Error('insert failed');
    return { meetingId, tile, lines };
  }

  it('makes one unnamed person per voice, gives them their lines and keeps the tile email to itself', async () => {
    const { meetingId, tile, lines } = await room();
    expect(await applyRoomVoices(test.db, meetingId, tile.id)).toBe(2);
    const made = await test.db.select().from(people).where(eq(people.unnamed, true));
    const names = made.map((p) => p.name).toSorted();
    expect(names).toEqual(['Voice 1 (Jo and Sam)', 'Voice 2 (Jo and Sam)']);
    for (const person of made) {
      expect(person.source).toBe('joined');
      expect(person.emails).toEqual([]);
    }
    const seats = await test.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, meetingId));
    const subs = seats.filter((s) => s.personId !== null);
    expect(subs).toHaveLength(2);
    for (const sub of subs) {
      expect(sub.email).toBeNull();
      expect(sub.inviteeEmails).toEqual([]);
      expect(sub.voiceEmbedding).toBeNull();
    }
    const after = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId));
    const by = (text: string) => after.find((l) => l.text === text);
    const nameOf = (id: string | null | undefined) => seats.find((s) => s.id === id)?.displayName;
    expect(nameOf(by('one')?.participantId)).toBe('Voice 1 (Jo and Sam)');
    expect(nameOf(by('two')?.participantId)).toBe('Voice 2 (Jo and Sam)');
    expect(by('mine')?.participantId).toBe(tile.id);
    expect(by('mine')?.speakerSource).toBe('user');
    expect(by('loose')?.participantId).toBe(tile.id);
    expect(by('loose')?.speakerConfidence).toBeLessThanOrEqual(0.5);
    expect(lines).toHaveLength(4);
  });

  it('keeps the same people when the meeting is processed again with the same count', async () => {
    const first = await room('again@example.com');
    await applyRoomVoices(test.db, first.meetingId, first.tile.id);
    const before = await test.db.select().from(sharedAccountVoices);
    // A second meeting from the same account reuses the people of the first.
    const second = await room('again@example.com');
    await applyRoomVoices(test.db, second.meetingId, second.tile.id);
    expect(await test.db.select().from(sharedAccountVoices)).toHaveLength(before.length);
    const used = await test.db
      .select()
      .from(roomVoices)
      .where(eq(roomVoices.meetingId, second.meetingId));
    const firstUsed = await test.db
      .select()
      .from(roomVoices)
      .where(eq(roomVoices.meetingId, first.meetingId));
    expect(used.map((v) => v.personId).toSorted()).toEqual(
      firstUsed.map((v) => v.personId).toSorted(),
    );
    // Applying once more changes nothing.
    await applyRoomVoices(test.db, second.meetingId, second.tile.id);
    const people2 = await test.db.select().from(people).where(eq(people.unnamed, true));
    expect(new Set(people2.map((p) => p.id)).size).toBe(people2.length);
  });

  it('remembers a count per account and forgets it without losing the people', async () => {
    const tile = { email: 'team@example.com', displayName: 'Team' };
    expect(await rememberedCount(test.db, tile)).toBeUndefined();
    await ensureAccount(test.db, tile);
    expect(await rememberedCount(test.db, tile)).toBeUndefined();
    await rememberCount(test.db, tile, 2);
    expect(
      await rememberedCount(test.db, { email: ' TEAM@example.com', displayName: 'Other' }),
    ).toBe(2);
    const listed = (await listRememberedAccounts(test.db)).find((a) => a.label === 'Team');
    expect(listed?.count).toBe(2);
    expect(await forgetAccount(test.db, listed?.id ?? '')).toBe(true);
    expect(await rememberedCount(test.db, tile)).toBeUndefined();
  });

  it('settles open questions with the detected count', async () => {
    const { meetingId, tile } = await room('open@example.com');
    expect(await openRoomQuestions(test.db, meetingId)).toEqual([]);
    await test.db
      .update(participants)
      .set({ roomAskedAt: new Date() })
      .where(eq(participants.id, tile.id));
    const open = await openRoomQuestions(test.db, meetingId);
    expect(open).toMatchObject([{ participantId: tile.id, voices: 2 }]);
    expect(await settleRoomQuestions(test.db, meetingId)).toBe(1);
    expect(await openRoomQuestions(test.db, meetingId)).toEqual([]);
    const [after] = await test.db.select().from(participants).where(eq(participants.id, tile.id));
    expect(after?.roomCount).toBe(2);
    const voices = await test.db
      .select()
      .from(roomVoices)
      .where(eq(roomVoices.meetingId, meetingId));
    expect(voices.every((v) => v.personId !== null)).toBe(true);
  });

  it('counts a split that is being worked on as open, and cancels it when settling', async () => {
    const [m] = await test.db
      .insert(meetings)
      .values({ title: 'x', platform: 'meet', joinUrl: 'https://meet.example.com/y' })
      .returning();
    const [tile] = await test.db
      .insert(participants)
      .values({
        meetingId: m?.id ?? '',
        displayName: 'Splitting',
        roomCount: 2,
        roomAskedAt: new Date(),
      })
      .returning();
    expect(await openRoomQuestions(test.db, m?.id ?? '')).toMatchObject([
      { participantId: tile?.id, splitting: true },
    ]);
    await settleRoomQuestions(test.db, m?.id ?? '');
    const [after] = await test.db
      .select()
      .from(participants)
      .where(eq(participants.id, tile?.id ?? ''));
    expect(after?.roomCount).toBeNull();
    expect(after?.roomAskedAt).toBeNull();
    expect(await openRoomQuestions(test.db, m?.id ?? '')).toEqual([]);
  });

  it('recognises a shared tile by voices, a count or a remembered account', async () => {
    const { tile } = await room('shared-check@example.com');
    expect(await isSharedTile(test.db, tile)).toBe(true);
    const plain = { id: tile.id.replace(/.$/, '0'), email: null, displayName: 'Plain Pat' };
    expect(await isSharedTile(test.db, plain)).toBe(false);
    expect(await isSharedTile(test.db, { ...plain, roomCount: 2 })).toBe(true);
    await rememberCount(test.db, plain, 3);
    expect(await isSharedTile(test.db, plain)).toBe(true);
  });

  it('takes the voices away again: lines back on the tile, unnamed people removed', async () => {
    const { meetingId, tile } = await room('reset@example.com');
    await applyRoomVoices(test.db, meetingId, tile.id);
    const named = await test.db
      .select()
      .from(roomVoices)
      .where(eq(roomVoices.meetingId, meetingId));
    const personIds = named.flatMap((v) => (v.personId ? [v.personId] : []));
    expect(personIds).toHaveLength(2);
    await resetRoomVoices(test.db, meetingId, tile.id);
    expect(
      await test.db.select().from(roomVoices).where(eq(roomVoices.meetingId, meetingId)),
    ).toEqual([]);
    const lines = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId));
    expect(lines.every((l) => l.participantId === tile.id)).toBe(true);
    expect(lines.find((l) => l.text === 'one')?.speakerSource).toBe('indicator');
    const seats = await test.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, meetingId));
    expect(seats).toHaveLength(1);
    for (const id of personIds) {
      expect(await test.db.select().from(people).where(eq(people.id, id))).toEqual([]);
    }
  });

  it('never makes a person from a shared tile when linking the people of a meeting', async () => {
    const { meetingId, tile } = await room('sync@example.com');
    await test.db
      .update(participants)
      .set({ nameConfirmed: true })
      .where(eq(participants.id, tile.id));
    await linkMeetingPeople(test.db, meetingId);
    expect(await test.db.select().from(people).where(eq(people.name, 'Jo and Sam'))).toEqual([]);
    const [after] = await test.db.select().from(participants).where(eq(participants.id, tile.id));
    expect(after?.personId).toBeNull();
  });

  it('keeps a person with an address of their own when the voices are reset, drops an empty one', async () => {
    const { meetingId, tile } = await room('reset@example.com');
    await applyRoomVoices(test.db, meetingId, tile.id);
    const seats = await test.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, meetingId));
    const subs = seats.filter((s) => s.personId !== null);
    const [first, second] = subs.toSorted((a, b) => a.displayName.localeCompare(b.displayName));
    // Voice 1 got an address typed on its seat, voice 2 got nothing.
    await test.db
      .update(participants)
      .set({ inviteeEmails: ['jo@example.com'] })
      .where(eq(participants.id, first?.id ?? ''));
    await resetRoomVoices(test.db, meetingId, tile.id);
    const after = await test.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, meetingId));
    expect(after.some((s) => s.id === first?.id)).toBe(true);
    expect(after.some((s) => s.id === second?.id)).toBe(false);
    const gone = await test.db
      .select()
      .from(people)
      .where(eq(people.id, second?.personId ?? ''));
    expect(gone).toEqual([]);
    // The line went back to the tile, and voice 1 keeps its person (its seat has an address).
    const lines = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId));
    expect(lines.every((l) => l.participantId === tile.id || l.speakerSource === 'user')).toBe(
      true,
    );
  });

  it('keeps the first people when a tile is split into fewer, and removes the rest', async () => {
    const { meetingId, tile } = await room('fewer@example.com');
    await applyRoomVoices(test.db, meetingId, tile.id);
    const voices = await test.db
      .select()
      .from(roomVoices)
      .where(eq(roomVoices.meetingId, meetingId));
    const ids = voices.toSorted((a, b) => a.number - b.number).map((v) => v.personId ?? '');
    await resetRoomVoices(test.db, meetingId, tile.id, 1);
    expect(
      await test.db
        .select()
        .from(people)
        .where(eq(people.id, ids[0] ?? '')),
    ).toHaveLength(1);
    expect(
      await test.db
        .select()
        .from(people)
        .where(eq(people.id, ids[1] ?? '')),
    ).toHaveLength(0);
  });

  it('counts a split to a new number as open while the old voices are still there', async () => {
    const { meetingId, tile } = await room('three@example.com');
    await test.db
      .update(participants)
      .set({ roomCount: 3, roomAskedAt: new Date() })
      .where(eq(participants.id, tile.id));
    expect(await openRoomQuestions(test.db, meetingId)).toMatchObject([
      { participantId: tile.id, voices: 2, splitting: true },
    ]);
    // Giving up takes the voices that exist as the answer.
    expect(await settleRoomQuestions(test.db, meetingId)).toBe(1);
    const [after] = await test.db.select().from(participants).where(eq(participants.id, tile.id));
    expect(after?.roomCount).toBe(2);
    expect(await openRoomQuestions(test.db, meetingId)).toEqual([]);
  });
});
