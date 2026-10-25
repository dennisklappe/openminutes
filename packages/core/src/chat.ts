import { asc, chatMessages, eq, meetings, type Database } from '@openminutes/db';
import { shiftToRange } from './speech-range.js';

export interface ChatLine {
  id: string;
  sender: string;
  text: string;
  links: string[];
  sentAt: Date;
  offsetMs: number;
}

/** Chat messages in transcript time: offsets follow the same trim as the transcript segments. */
export async function loadChatLines(db: Database, meetingId: string): Promise<ChatLine[]> {
  const [meeting] = await db
    .select({ trimStartMs: meetings.trimStartMs, trimEndMs: meetings.trimEndMs })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  const range =
    meeting && meeting.trimStartMs !== null && meeting.trimEndMs !== null
      ? { startMs: meeting.trimStartMs, endMs: meeting.trimEndMs }
      : null;
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.meetingId, meetingId))
    .orderBy(asc(chatMessages.offsetMs), asc(chatMessages.sentAt));
  return rows.map((row) => ({
    id: row.id,
    sender: row.sender,
    text: row.text,
    links: row.links,
    sentAt: row.sentAt,
    offsetMs: range ? shiftToRange(row.offsetMs, range) : row.offsetMs,
  }));
}
