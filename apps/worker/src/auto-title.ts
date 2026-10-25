import { and, eq, meetings, type Database } from '@openminutes/db';
import type { SummaryProvider } from '@openminutes/providers';

const MAX_TITLE_WORDS = 10;
const MAX_TITLE_CHARS = 80;
const QUOTES = /^["'`“”‘’«»]+|["'`“”‘’«»]+$/g;

export const TITLE_INSTRUCTIONS = `Write a short title for a recording from the summary below. Use at most 6 words, the same language as the summary, no quotes, no full stop at the end and no dashes. Reply with the title only.`;

export function cleanTitle(reply: string): string | undefined {
  const firstLine = reply.split('\n').find((line) => line.trim() !== '') ?? '';
  const title = firstLine
    .replace(/^[#*\s]+|[*\s]+$/g, '')
    .replace(QUOTES, '')
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/[.,\s]+$/, '')
    .replace(/^,\s*/, '')
    .trim();
  const words = title.split(' ').length;
  return title === '' || title.length > MAX_TITLE_CHARS || words > MAX_TITLE_WORDS
    ? undefined
    : title;
}

/**
 * Titles a phone recording from its summary. Calendar and link meetings and recordings whose title
 * the user edited are left alone, and the update repeats the check in SQL so an edit made while the
 * model was answering is never overwritten. Failures keep the current title.
 */
export async function titleRecording(
  db: Database,
  provider: SummaryProvider,
  meetingId: string,
  summary: string,
): Promise<void> {
  try {
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    if (meeting?.platform !== 'recording' || meeting.titleEdited) return;
    const reply = await provider.summarize(
      summary.slice(0, provider.maxInputChars),
      TITLE_INSTRUCTIONS,
    );
    const title = cleanTitle(reply);
    if (!title) return;
    await db
      .update(meetings)
      .set({ title })
      .where(
        and(
          eq(meetings.id, meetingId),
          eq(meetings.titleEdited, false),
          eq(meetings.platform, 'recording'),
        ),
      );
  } catch (error) {
    console.error(`title of meeting ${meetingId} could not be generated, keeping it`, error);
  }
}
