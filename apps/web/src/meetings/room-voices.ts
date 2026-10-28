import { SUSPECT_CONFIDENCE_CAP } from '@openminutes/core';
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
  RoomNameInput,
  RoomNoticeDto,
  RoomReviewDto,
  RoomVoiceDto,
} from '../dto.js';
import { createPerson, PeopleError } from '../people/edit.js';
import { loadChoices } from '../people/load.js';
import { verifyInTx, type LearnRequest } from '../people/lines.js';

/** Clear lines offered to listen to per voice. */
const SNIPPETS = 3;

/** The tiles that probably hold several people and have a voice without a person. */
export async function loadRoomNotices(db: Database, meetingId: string): Promise<RoomNoticeDto[]> {
  const voices = await db.select().from(roomVoices).where(eq(roomVoices.meetingId, meetingId));
  if (voices.length === 0) return [];
  const tiles = await db
    .select({ id: participants.id, name: participants.displayName })
    .from(participants)
    .where(
      and(
        eq(participants.meetingId, meetingId),
        inArray(participants.id, [...new Set(voices.map((v) => v.participantId))]),
        isNull(participants.roomDismissedAt),
      ),
    );
  return tiles
    .map((tile) => {
      const own = voices.filter((v) => v.participantId === tile.id);
      return {
        participantId: tile.id,
        name: tile.name,
        voices: own.length,
        unnamed: own.filter((v) => v.personId === null).length,
      };
    })
    .filter((notice) => notice.unnamed > 0);
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
      personName: voice.personId ? (names.get(voice.personId) ?? null) : null,
      snippets: clearest.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
    };
  });
  const listed = new Set<string>();
  const roster: ReviewRosterDto[] = [];
  for (const seat of seats) {
    if (seat.isBot || seat.id === participantId) continue;
    if (seat.personId && hidden.has(seat.personId)) continue;
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
    people: choices,
    learning: rememberOn,
  };
}

/**
 * Gives a voice of a shared tile to a person, from People or new. Its lines take that person as
 * a verified label, the same path as verifying a line, except lines a person set before, which
 * stay as they are. The lines of the tile that fit no voice (overlap, too short) are made
 * uncertain so they show up in review. Returns what the voice learning needs.
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
  if (voice.personId) throw new PeopleError('This voice is named already', 409);
  const personId =
    'personId' in input ? input.personId : (await createPerson(db, { name: input.newName })).id;
  const learn = await db.transaction(async (tx) => {
    const [person] = await tx.select().from(people).where(eq(people.id, personId));
    if (!person) throw new PeopleError('Person not found', 404);
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
    await tx
      .update(roomVoices)
      .set({ personId, namedAt: new Date() })
      .where(eq(roomVoices.id, voice.id));
    await tx
      .update(transcriptSegments)
      .set({
        speakerConfidence: sql`least(coalesce(${transcriptSegments.speakerConfidence}, 1), ${SUSPECT_CONFIDENCE_CAP})`,
      })
      .where(
        and(
          eq(transcriptSegments.meetingId, meetingId),
          eq(transcriptSegments.participantId, voice.participantId),
          isNull(transcriptSegments.roomVoiceId),
          sql`${transcriptSegments.speakerSource} is distinct from 'user'`,
        ),
      );
    return participantId
      ? { meetingId, participantId, segmentIds: lines.map((line) => line.id) }
      : undefined;
  });
  return { learn, personId };
}

/** The owner says the tile is one person: its voices go and it is not offered again. */
export async function dismissRoom(
  db: Database,
  meetingId: string,
  participantId: string,
): Promise<void> {
  const [tile] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(and(eq(participants.id, participantId), eq(participants.meetingId, meetingId)));
  if (!tile) throw new PeopleError('Participant not found', 404);
  const named = await db
    .select({ id: roomVoices.id })
    .from(roomVoices)
    .where(
      and(eq(roomVoices.participantId, participantId), sql`${roomVoices.personId} is not null`),
    )
    .limit(1);
  if (named.length > 0) throw new PeopleError('Some of these voices are named already', 409);
  await db.transaction(async (tx) => {
    await tx
      .update(participants)
      .set({ roomDismissedAt: new Date() })
      .where(eq(participants.id, participantId));
    await tx.delete(roomVoices).where(eq(roomVoices.participantId, participantId));
  });
}
