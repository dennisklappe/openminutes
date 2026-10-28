import { BOT_DEFAULTS, loadChatLines, type SettingsStore } from '@openminutes/core';
import {
  and,
  asc,
  eq,
  meetings,
  participants,
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
  return buildMinutes({
    meeting,
    participants: people.map((seat) => ({ ...seat, hidden: hidden.has(seat.id) })),
    botName: botName?.trim() || BOT_DEFAULTS.name,
    summary: summary?.content ?? null,
    segments,
    chat: chat.map(({ sender, text, links, offsetMs }) => ({ sender, text, links, offsetMs })),
  });
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
