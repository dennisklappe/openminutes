import { chatMessages, type Database } from '@openminutes/db';
import type { TrackedChat } from './chat-tracker.js';

export async function saveChat(
  db: Database,
  meetingId: string,
  messages: TrackedChat[],
): Promise<void> {
  if (messages.length === 0) return;
  await db
    .insert(chatMessages)
    .values(
      messages.map((message) => ({
        meetingId,
        dedupeKey: message.key,
        sender: message.sender,
        text: message.text,
        links: message.links,
        sentAt: message.sentAt,
        offsetMs: message.offsetMs,
      })),
    )
    .onConflictDoNothing();
}
