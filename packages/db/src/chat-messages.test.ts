import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { chatMessages, meetings } from './schema.js';
import { createTestDatabase } from './testing/index.js';

const message = (meetingId: string, dedupeKey: string) => ({
  meetingId,
  dedupeKey,
  sender: 'Alice',
  text: 'See https://example.com',
  links: ['https://example.com'],
  sentAt: new Date('2026-10-22T10:00:05Z'),
  offsetMs: 5000,
});

describe('chat_messages', () => {
  it('keeps one row per dedupe key and goes away with the meeting', async () => {
    const test = await createTestDatabase();
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Sync', platform: 'meet', joinUrl: 'https://meet.google.com/abc-defg-hij' })
      .returning({ id: meetings.id });
    if (!meeting) throw new Error('meeting was not created');
    const meetingId = meeting.id;

    await test.db
      .insert(chatMessages)
      .values([message(meetingId, 'a'), message(meetingId, 'a')])
      .onConflictDoNothing();
    await test.db.insert(chatMessages).values(message(meetingId, 'b'));
    const rows = await test.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.meetingId, meetingId));
    expect(rows.map((row) => row.dedupeKey).sort()).toEqual(['a', 'b']);
    expect(rows[0]?.links).toEqual(['https://example.com']);

    await test.db.delete(meetings).where(eq(meetings.id, meetingId));
    expect(await test.db.select().from(chatMessages)).toEqual([]);
    await test.close();
  });
});
