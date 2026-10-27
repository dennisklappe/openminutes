import {
  applyRoomVoices,
  rememberCount,
  resetRoomVoices,
  SHARED_MAX_PEOPLE,
  SHARED_WAIT_DEFAULT_MINUTES,
  type JobSender,
} from '@openminutes/core';
import {
  and,
  asc,
  audioFiles,
  eq,
  inArray,
  isNull,
  meetings,
  participants,
  people,
  roomVoices,
  sql,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import type {
  ReviewRosterDto,
  RoomCountInput,
  RoomNameInput,
  RoomNoticeDto,
  RoomReviewDto,
  RoomVoiceDto,
} from '../dto.js';
import { PeopleError } from '../people/edit.js';
import { nameVoicePerson } from '../people/name-voice.js';
import { markSpeakersChanged } from './speakers-notice.js';
import { attachVoiceEmails, checkVoiceEmails, readVoiceEmails } from './room-emails.js';
import { loadChoices } from '../people/load.js';
import { verifyInTx, type LearnRequest } from '../people/lines.js';

/** Clear lines offered to listen to per voice. */
const SNIPPETS = 3;

/**
 * The tiles that probably hold several people and wait for "how many?": voices were found, the
 * owner (or a remembered account) has not said how many people there are, and it was not
 * called one person.
 */
export async function loadRoomNotices(
  db: Database,
  meetingId: string,
  waitMinutes: number = SHARED_WAIT_DEFAULT_MINUTES,
  now: Date = new Date(),
): Promise<RoomNoticeDto[]> {
  const voices = await db.select().from(roomVoices).where(eq(roomVoices.meetingId, meetingId));
  if (voices.length === 0) return [];
  const tiles = await db
    .select({
      id: participants.id,
      name: participants.displayName,
      askedAt: participants.roomAskedAt,
    })
    .from(participants)
    .where(
      and(
        eq(participants.meetingId, meetingId),
        inArray(participants.id, [...new Set(voices.map((v) => v.participantId))]),
        isNull(participants.roomDismissedAt),
        isNull(participants.roomCount),
      ),
    );
  return tiles.map((tile) => {
    const own = voices.filter((v) => v.participantId === tile.id);
    const until =
      tile.askedAt && waitMinutes > 0
        ? new Date(tile.askedAt.getTime() + waitMinutes * 60_000)
        : undefined;
    return {
      participantId: tile.id,
      name: tile.name,
      voices: own.length,
      unnamed: own.filter((v) => v.personId === null).length,
      waitsUntil: until && until > now ? until.toISOString() : null,
    };
  });
}

/** The page that names the voices of one tile. Undefined when the tile has no shared voices. */
export async function loadRoomReview(
  db: Database,
  rememberOn: boolean,
  meetingId: string,
  participantId: string,
): Promise<RoomReviewDto | undefined> {
  const [meeting] = await db
    .select({ id: meetings.id, title: meetings.title })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  const [tile] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.id, participantId), eq(participants.meetingId, meetingId)));
  if (!meeting || !tile || tile.roomDismissedAt) return undefined;
  const voices = await db
    .select()
    .from(roomVoices)
    .where(and(eq(roomVoices.participantId, participantId), eq(roomVoices.meetingId, meetingId)))
    .orderBy(asc(roomVoices.number));
  if (voices.length === 0) return undefined;
  const [lines, seats, choices, audio] = await Promise.all([
    db
      .select()
      .from(transcriptSegments)
      .where(
        inArray(
          transcriptSegments.roomVoiceId,
          voices.map((v) => v.id),
        ),
      )
      .orderBy(asc(transcriptSegments.startMs)),
    db.select().from(participants).where(eq(participants.meetingId, meetingId)),
    loadChoices(db),
    db
      .select({ id: audioFiles.id })
      .from(audioFiles)
      .where(eq(audioFiles.meetingId, meetingId))
      .limit(1),
  ]);
  const names = new Map(choices.map((p) => [p.id, p.name]));
  const emailsOf = new Map(
    (await db.select({ id: people.id, emails: people.emails }).from(people)).map((p) => [
      p.id,
      p.emails,
    ]),
  );
  const owners = voices.flatMap((v) => (v.personId ? [v.personId] : []));
  const made =
    owners.length === 0
      ? []
      : await db
          .select({ id: people.id, name: people.name, unnamed: people.unnamed })
          .from(people)
          .where(inArray(people.id, owners));
  const madeBy = new Map(made.map((p) => [p.id, p]));
  const hidden = new Set(choices.filter((p) => p.tracked === false).map((p) => p.id));
  const dtos = voices.map((voice): RoomVoiceDto => {
    const own = lines.filter((line) => line.roomVoiceId === voice.id);
    const clearest = own
      .toSorted((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
      .slice(0, SNIPPETS)
      .toSorted((a, b) => a.startMs - b.startMs);
    return {
      id: voice.id,
      number: voice.number,
      lines: own.length,
      durationMs: voice.durationMs,
      personId: voice.personId,
      personName: voice.personId ? (madeBy.get(voice.personId)?.name ?? null) : null,
      unnamed: voice.personId === null || madeBy.get(voice.personId)?.unnamed !== false,
      snippets: clearest.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
    };
  });
  const listed = new Set<string>();
  const roster: ReviewRosterDto[] = [];
  for (const seat of seats) {
    if (seat.isBot || seat.id === participantId) continue;
    if (seat.personId && (hidden.has(seat.personId) || owners.includes(seat.personId))) continue;
    if (seat.personId === null && !seat.nameConfirmed) continue;
    const key = seat.personId ?? `name:${seat.displayName.toLowerCase()}`;
    if (listed.has(key)) continue;
    listed.add(key);
    roster.push({
      personId: seat.personId,
      name: (seat.personId ? names.get(seat.personId) : undefined) ?? seat.displayName,
    });
  }
  return {
    meetingId,
    meetingTitle: meeting.title,
    hasAudio: audio.length > 0,
    participant: { id: tile.id, name: tile.displayName },
    voices: dtos,
    roster: roster.toSorted((a, b) => a.name.localeCompare(b.name)),
    people: choices.map((choice) => ({ ...choice, emails: emailsOf.get(choice.id) ?? [] })),
    learning: rememberOn,
  };
}

/**
 * Gives a voice of a shared tile its name: the person made for it is renamed, or folded into an
 * existing person, or a new person is made with the typed name (the same thing as renaming).
 * Its lines of this meeting then count as lines the owner verified, except lines a person set
 * before. The lines of the tile that fit no voice are made uncertain so they show in review.
 * Returns what the voice learning needs.
 */
export async function nameRoomVoice(
  db: Database,
  meetingId: string,
  voiceId: string,
  input: RoomNameInput,
): Promise<{ learn: LearnRequest | undefined; personId: string }> {
  const [voice] = await db
    .select()
    .from(roomVoices)
    .where(and(eq(roomVoices.id, voiceId), eq(roomVoices.meetingId, meetingId)));
  if (!voice) throw new PeopleError('Voice not found', 404);
  const siblings = await db
    .select({ id: roomVoices.id })
    .from(roomVoices)
    .where(eq(roomVoices.participantId, voice.participantId));
  const count = siblings.length;
  const [owner] = voice.personId
    ? await db.select().from(people).where(eq(people.id, voice.personId))
    : [];
  if (owner && !owner.unnamed) throw new PeopleError('This voice is named already', 409);
  const emails = await readVoiceEmails(db, meetingId, input);
  // A voice without a person yet (found before people were made for voices) gets one first.
  const placeholder =
    owner?.id ??
    (await (async () => {
      // Naming a voice says there are several people: the others become people too.
      await db
        .update(participants)
        .set({ roomCount: sql`coalesce(${participants.roomCount}, ${count})`, roomAskedAt: null })
        .where(eq(participants.id, voice.participantId));
      await applyRoomVoices(db, meetingId, voice.participantId);
      const [again] = await db.select().from(roomVoices).where(eq(roomVoices.id, voice.id));
      if (!again?.personId) throw new PeopleError('Voice not found', 404);
      return again.personId;
    })());
  await checkVoiceEmails(db, meetingId, placeholder, emails);
  const personId = await nameVoicePerson(
    db,
    placeholder,
    'personId' in input ? { personId: input.personId } : { name: input.newName },
  );
  const learn = await db.transaction(async (tx) => {
    const [person] = await tx.select().from(people).where(eq(people.id, personId));
    if (!person) throw new PeopleError('Person not found', 404);
    await tx
      .update(roomVoices)
      .set({ personId, namedAt: new Date() })
      .where(eq(roomVoices.id, voice.id));
    const lines = await tx
      .select()
      .from(transcriptSegments)
      .where(
        and(
          eq(transcriptSegments.roomVoiceId, voice.id),
          // A line a person set is never taken over.
          sql`${transcriptSegments.speakerSource} is distinct from 'user'`,
        ),
      );
    let participantId: string | undefined;
    for (const line of lines) participantId = await verifyInTx(tx, person, line);
    return participantId
      ? { meetingId, participantId, segmentIds: lines.map((line) => line.id) }
      : undefined;
  });
  await attachVoiceEmails(db, meetingId, personId, emails);
  return { learn, personId };
}

/**
 * The owner says the tile is one person: its voices, and the people made for them, go and it is
 * not offered again. Not possible once a voice has a name. Remembered for the next meeting.
 */
export async function dismissRoom(
  db: Database,
  meetingId: string,
  participantId: string,
): Promise<void> {
  const [tile] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.id, participantId), eq(participants.meetingId, meetingId)));
  if (!tile) throw new PeopleError('Participant not found', 404);
  await assertNoneNamed(db, participantId);
  await resetRoomVoices(db, meetingId, participantId);
  await db.transaction(async (tx) => {
    await tx
      .update(participants)
      .set({ roomDismissedAt: new Date(), roomCount: null, roomAskedAt: null })
      .where(eq(participants.id, participantId));
    await tx.delete(roomVoices).where(eq(roomVoices.participantId, participantId));
  });
  await rememberCount(db, tile, 1);
  await markSpeakersChanged(db, meetingId);
}

async function assertNoneNamed(db: Database, participantId: string): Promise<void> {
  const named = await db
    .select({ id: roomVoices.id })
    .from(roomVoices)
    .innerJoin(people, eq(people.id, roomVoices.personId))
    .where(and(eq(roomVoices.participantId, participantId), eq(people.unnamed, false)))
    .limit(1);
  if (named.length > 0) throw new PeopleError('Some of these voices are named already', 409);
}

/**
 * Says how many people are in a tile. 1 is "it is one person". "Not sure" takes the number of
 * voices that was found. Another number clusters the tile again with that many voices (a worker
 * job, because it listens to the audio) unless that many voices exist already. Every answer
 * but "not sure" is remembered for the next meeting from this account.
 */
export async function setRoomCount(
  db: Database,
  queue: JobSender,
  meetingId: string,
  participantId: string,
  input: RoomCountInput,
): Promise<{ splitting: boolean }> {
  const [tile] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.id, participantId), eq(participants.meetingId, meetingId)));
  if (!tile) throw new PeopleError('Participant not found', 404);
  const voices = await db
    .select()
    .from(roomVoices)
    .where(and(eq(roomVoices.participantId, participantId), eq(roomVoices.meetingId, meetingId)));
  if ('unsure' in input) {
    if (voices.length === 0) throw new PeopleError('No voices were found in this participant', 409);
    await db
      .update(participants)
      .set({ roomCount: voices.length, roomAskedAt: null, roomDismissedAt: null })
      .where(eq(participants.id, participantId));
    await applyRoomVoices(db, meetingId, participantId);
    await markSpeakersChanged(db, meetingId);
    return { splitting: false };
  }
  const { count } = input;
  if (count === 1) {
    await dismissRoom(db, meetingId, participantId);
    return { splitting: false };
  }
  if (!Number.isInteger(count) || count < 2 || count > SHARED_MAX_PEOPLE) {
    throw new PeopleError(`Pick a number from 1 to ${String(SHARED_MAX_PEOPLE)}`, 400);
  }
  await assertNoneNamed(db, participantId);
  if (voices.length === count) {
    await db
      .update(participants)
      .set({ roomCount: count, roomAskedAt: null, roomDismissedAt: null })
      .where(eq(participants.id, participantId));
    await applyRoomVoices(db, meetingId, participantId);
    await rememberCount(db, tile, count);
    await markSpeakersChanged(db, meetingId);
    return { splitting: false };
  }
  const audio = await db
    .select({ id: audioFiles.id })
    .from(audioFiles)
    .where(eq(audioFiles.meetingId, meetingId))
    .limit(1);
  if (audio.length === 0) throw new PeopleError('This meeting has no audio to listen to', 409);
  // The summary waits for the split from now on.
  await db
    .update(participants)
    .set({ roomCount: count, roomAskedAt: new Date(), roomDismissedAt: null })
    .where(eq(participants.id, participantId));
  await queue.send('meeting.split-room', { meetingId, participantId, count });
  return { splitting: true };
}
