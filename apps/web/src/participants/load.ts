import { BOT_DEFAULTS, type SettingsStore } from '@openminutes/core';
import {
  and,
  asc,
  audioFiles,
  eq,
  inArray,
  meetings,
  participants,
  people,
  roomVoices,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import { unmatchedInvitees } from '@openminutes/minutes';
import type { ParticipantDto, ParticipantsDto, RoomGroupDto, SubPersonDto } from '../dto.js';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Clear lines offered to listen to per voice. */
const SNIPPETS = 3;

export interface ParticipantDeps {
  db: Database;
  settings: SettingsStore;
}

export async function loadParticipants(
  { db, settings }: ParticipantDeps,
  meetingId: string,
): Promise<Omit<ParticipantsDto, 'summaryUpdated'>> {
  const [[meeting], seats, segments, botName] = await Promise.all([
    db
      .select({ invitees: meetings.invitees, dismissed: meetings.dismissedInvitees })
      .from(meetings)
      .where(eq(meetings.id, meetingId)),
    db
      .select()
      .from(participants)
      .where(and(eq(participants.meetingId, meetingId), eq(participants.isBot, false)))
      .orderBy(asc(participants.joinedAt), asc(participants.displayName)),
    db
      .select({
        participantId: transcriptSegments.participantId,
        startMs: transcriptSegments.startMs,
        endMs: transcriptSegments.endMs,
        text: transcriptSegments.text,
        roomVoiceId: transcriptSegments.roomVoiceId,
      })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId)),
    settings.get('bot.name'),
  ]);
  const [voices, audio] = await Promise.all([
    db.select().from(roomVoices).where(eq(roomVoices.meetingId, meetingId)),
    db
      .select({ id: audioFiles.id })
      .from(audioFiles)
      .where(eq(audioFiles.meetingId, meetingId))
      .limit(1),
  ]);
  const owners = await db
    .select({ id: people.id, name: people.name, unnamed: people.unnamed, emails: people.emails })
    .from(people)
    .where(
      inArray(
        people.id,
        voices.flatMap((v) => (v.personId ? [v.personId] : [])),
      ),
    );
  const bot = botName?.trim() || BOT_DEFAULTS.name;
  const talk = new Map<string, number>();
  const lines = new Map<string, number>();
  // What each voice said while the line is still with the person of the voice.
  const voiceTalk = new Map<string, number>();
  const voiceLines = new Map<string, number>();
  const voiceOf = new Map(voices.map((voice) => [voice.id, voice]));
  const seatIdOfPerson = new Map(
    seats.flatMap((seat) => (seat.personId ? [[seat.personId, seat.id] as const] : [])),
  );
  // Per seat: what its voices said, so the seat keeps only what is not a voice's line.
  const viaVoices = { talk: new Map<string, number>(), lines: new Map<string, number>() };
  for (const { participantId, startMs, endMs, roomVoiceId } of segments) {
    if (!participantId) continue;
    talk.set(participantId, (talk.get(participantId) ?? 0) + endMs - startMs);
    lines.set(participantId, (lines.get(participantId) ?? 0) + 1);
    const voice = roomVoiceId ? voiceOf.get(roomVoiceId) : undefined;
    if (voice?.personId && seatIdOfPerson.get(voice.personId) === participantId) {
      voiceTalk.set(voice.id, (voiceTalk.get(voice.id) ?? 0) + endMs - startMs);
      voiceLines.set(voice.id, (voiceLines.get(voice.id) ?? 0) + 1);
      viaVoices.talk.set(participantId, (viaVoices.talk.get(participantId) ?? 0) + endMs - startMs);
      viaVoices.lines.set(participantId, (viaVoices.lines.get(participantId) ?? 0) + 1);
    }
  }
  /** Lines of the seat that no voice of a tile said: the seat is a participant of its own. */
  const ownLines = (seatId: string) =>
    (lines.get(seatId) ?? 0) - (viaVoices.lines.get(seatId) ?? 0);
  const humans = seats.filter((seat) => !same(seat.displayName, bot));
  const invitees = meeting?.invitees ?? [];
  const dismissed = new Set((meeting?.dismissed ?? []).map((email) => email.toLowerCase()));

  const ownerOf = new Map(owners.map((owner) => [owner.id, owner]));
  const seatOf = new Map(
    humans.flatMap((seat) => (seat.personId ? [[seat.personId, seat] as const] : [])),
  );
  const tiles = new Map<string, RoomGroupDto>();
  const subSeats = new Set<string>();
  for (const tile of humans) {
    const own = voices
      .filter((v) => v.participantId === tile.id)
      .toSorted((a, b) => a.number - b.number);
    if (own.length === 0 && !(tile.roomCount !== null && tile.roomAskedAt !== null)) continue;
    if (tile.roomDismissedAt) continue;
    const subs = own.flatMap((voice): SubPersonDto[] => {
      const owner = voice.personId ? ownerOf.get(voice.personId) : undefined;
      const seat = voice.personId ? seatOf.get(voice.personId) : undefined;
      if (!owner || !seat) return [];
      // A seat with lines of its own is a participant too (the same person joined by themselves):
      // it keeps its row and the voice shows only its own lines. Else the seat only exists for
      // the voice and is not listed twice.
      const separate = ownLines(seat.id) > 0;
      if (!separate) subSeats.add(seat.id);
      const clearest = segments
        .filter((l) => l.roomVoiceId === voice.id)
        .toSorted((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
        .slice(0, SNIPPETS)
        .toSorted((a, b) => a.startMs - b.startMs);
      return [
        {
          voiceId: voice.id,
          personId: owner.id,
          participantId: seat.id,
          number: voice.number,
          name: owner.name,
          unnamed: owner.unnamed,
          lines: voiceLines.get(voice.id) ?? 0,
          talkMs: voiceTalk.get(voice.id) ?? 0,
          seatSeparate: separate,
          snippets: clearest.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
          emails: owner.emails,
          inviteeEmails: seat.inviteeEmails,
          email: seat.email,
        },
      ];
    });
    tiles.set(tile.id, {
      count: tile.roomCount,
      detected: own.length,
      subs,
      hasAudio: audio.length > 0,
      canSplit: audio.length > 0 && subs.every((sub) => sub.unnamed),
      tileEmail: tile.email,
      splitting:
        tile.roomCount !== null && tile.roomAskedAt !== null && own.length !== tile.roomCount,
    });
  }
  const toDto = (seat: (typeof humans)[number]): ParticipantDto => {
    const room = tiles.get(seat.id);
    return {
      id: seat.id,
      name: seat.displayName,
      originalName:
        seat.originalName && !same(seat.originalName, seat.displayName) ? seat.originalName : null,
      joinedAt: seat.joinedAt?.toISOString() ?? null,
      leftAt: seat.leftAt?.toISOString() ?? null,
      talkMs: (talk.get(seat.id) ?? 0) - (viaVoices.talk.get(seat.id) ?? 0),
      confirmed: seat.nameConfirmed,
      email: seat.email,
      inviteeEmails: seat.inviteeEmails,
      ...(room && { room }),
      canSplit: audio.length > 0 && !room,
    };
  };
  return {
    invitees,
    absent: unmatchedInvitees(invitees, humans).filter(
      (invitee) => !dismissed.has(invitee.email.toLowerCase()),
    ),
    participants: humans.filter((seat) => !subSeats.has(seat.id)).map(toDto),
  };
}
