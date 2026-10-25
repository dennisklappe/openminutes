import { BOT_DEFAULTS, loadChatLines, type SettingsStore } from '@openminutes/core';
import {
  and,
  asc,
  eq,
  meetings,
  participants,
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
  const [people, segments, summary, botName, chat] = await Promise.all([
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
  ]);
  return buildMinutes({
    meeting,
    participants: people,
    botName: botName?.trim() || BOT_DEFAULTS.name,
    summary: summary?.content ?? null,
    segments,
    chat: chat.map(({ sender, text, links, offsetMs }) => ({ sender, text, links, offsetMs })),
  });
}
