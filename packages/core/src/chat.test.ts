import { chatMessages, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { describe, expect, it } from 'vitest';
import { loadChatLines } from './chat.js';

describe('loadChatLines', () => {
  it('orders by offset and shifts offsets by the transcript trim', async () => {
    const test = await createTestDatabase();
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Sync',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        trimStartMs: 10_000,
        trimEndMs: 60_000,
      })
      .returning({ id: meetings.id });
    if (!meeting) throw new Error('meeting was not created');
    const meetingId = meeting.id;
    const row = (dedupeKey: string, offsetMs: number) => ({
      meetingId,
      dedupeKey,
      sender: 'Alice',
      text: dedupeKey,
      links: [],
      sentAt: new Date('2026-10-22T10:00:00Z'),
      offsetMs,
    });
    await test.db.insert(chatMessages).values([row('late', 30_000), row('early', 4_000)]);

    const lines = await loadChatLines(test.db, meetingId);
    expect(lines.map((line) => [line.text, line.offsetMs])).toEqual([
      ['early', 0],
      ['late', 20_000],
    ]);
    await test.close();
  });
});
