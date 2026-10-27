import { BOT_DEFAULTS, loadChatLines, type SettingsStore } from '@openminutes/core';
import {
  and,
  asc,
  eq,
  meetings,
  inArray,
  participants,
  people as peopleTable,
  roomVoices,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import { buildMinutes, type Minutes } from '@openminutes/minutes';
import { findDoneSummary } from './summary-edit.js';

interface AssembleDeps {
  db: Database;
  settings: SettingsStore;
}

export async function assembleMinutes(
  { db, settings }: AssembleDeps,
  meetingId: string,
): Promise<Minutes | undefined> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting || meeting.deletedAt) return undefined;
  const [people, segments, summary, botName, chat, hidden] = await Promise.all([
    db
      .select()
      .from(participants)
      .where(and(eq(participants.meetingId, meetingId), eq(participants.isBot, false)))
      .orderBy(asc(participants.joinedAt), asc(participants.displayName)),
    db
      .select({
        startMs: transcriptSegments.startMs,
        endMs: transcriptSegments.endMs,
        text: transcriptSegments.text,
        speaker: participants.displayName,
      })
      .from(transcriptSegments)
      .leftJoin(participants, eq(participants.id, transcriptSegments.participantId))
      .where(eq(transcriptSegments.meetingId, meetingId))
      .orderBy(asc(transcriptSegments.startMs)),
    findDoneSummary(db, meetingId),
    settings.get('bot.name'),
    loadChatLines(db, meetingId),
    sharedTilesNamed(db, meetingId),
  ]);
  const known = await knownEmails(db, people, hidden);
  return buildMinutes({
    meeting,
    participants: people.map((seat) => ({
      ...seat,
      email: seat.email ?? known.get(seat.id) ?? null,
      hidden: hidden.has(seat.id),
    })),
    botName: botName?.trim() || BOT_DEFAULTS.name,
    summary: summary?.content ?? null,
    segments,
    chat: chat.map(({ sender, text, links, offsetMs }) => ({ sender, text, links, offsetMs })),
  });
}

/**
 * The first email of the person behind a seat that has no address typed on the meeting, so a voice
 * named as someone who already has an email still gets the minutes. The address of a shared tile
 * never counts, even when the person has it on record.
 */
async function knownEmails(
  db: Database,
  seats: readonly { id: string; email: string | null; personId: string | null }[],
  hidden: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const linked = seats.filter((seat) => seat.personId && !seat.email && !hidden.has(seat.id));
  if (linked.length === 0) return new Map();
  const owners = await db
    .select({ id: peopleTable.id, emails: peopleTable.emails })
    .from(peopleTable)
    .where(inArray(peopleTable.id, [...new Set(linked.map((seat) => seat.personId ?? ''))]));
  const tileEmails = new Set(
    seats.flatMap((seat) => (hidden.has(seat.id) && seat.email ? [seat.email.toLowerCase()] : [])),
  );
  const result = new Map<string, string>();
  for (const seat of linked) {
    const own = owners
      .find((owner) => owner.id === seat.personId)
      ?.emails.find((email) => !tileEmails.has(email.toLowerCase()));
    if (own) result.set(seat.id, own);
  }
  return result;
}

/**
 * Shared tiles whose voices all have a person of their own: the minutes list those people and
 * not the tile, and the tile's address goes to nobody unless it was assigned to one of them.
 */
export async function sharedTilesNamed(db: Database, meetingId: string): Promise<Set<string>> {
  const voices = await db
    .select({ tile: roomVoices.participantId, personId: roomVoices.personId })
    .from(roomVoices)
    .where(eq(roomVoices.meetingId, meetingId));
  const tiles = new Set(voices.map((v) => v.tile));
  return new Set(
    [...tiles].filter((tile) =>
      voices.filter((v) => v.tile === tile).every((v) => v.personId !== null),
    ),
  );
}
