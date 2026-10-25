import { chatMessages, eq, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { expect, it } from 'vitest';
import { saveChat } from './chat-store.js';

it('stores messages once even when the same batch is saved again', async () => {
  const test = await createTestDatabase();
  const [meeting] = await test.db
    .insert(meetings)
    .values({ title: 'Sync', platform: 'meet', joinUrl: 'https://meet.google.com/abc-defg-hij' })
    .returning({ id: meetings.id });
  if (!meeting) throw new Error('meeting was not created');
  const batch = [
    {
      key: 'k1',
      sender: 'Alice',
      text: 'see https://example.com',
      links: ['https://example.com'],
      sentAt: new Date('2026-10-22T10:00:05Z'),
      offsetMs: 5_000,
    },
  ];

  await saveChat(test.db, meeting.id, batch);
  await saveChat(test.db, meeting.id, batch);
  await saveChat(test.db, meeting.id, []);

  const rows = await test.db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.meetingId, meeting.id));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    sender: 'Alice',
    offsetMs: 5_000,
    links: ['https://example.com'],
  });
  await test.close();
});
