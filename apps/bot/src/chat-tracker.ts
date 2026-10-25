import { createHash } from 'node:crypto';
import type { ChatMessage } from '@openminutes/platforms';

export interface TrackedChat {
  key: string;
  sender: string;
  text: string;
  links: string[];
  sentAt: Date;
  offsetMs: number;
}

/** A guest controls what the chat panel shows, so what is stored from it is capped. */
export const MAX_CHAT_MESSAGES = 5_000;
export const MAX_CHAT_TEXT = 4_000;
export const MAX_CHAT_SENDER = 200;
const MAX_CHAT_LINKS = 20;
const MAX_CHAT_LINK = 2_000;

const keyOf = (message: ChatMessage, occurrence: number) =>
  createHash('sha256')
    .update([message.time ?? '', message.sender, message.text, occurrence].join('\u0000'))
    .digest('hex')
    .slice(0, 32);

export class ChatTracker {
  private readonly seen = new Set<string>();
  private readonly messages: TrackedChat[] = [];
  private saved = 0;

  constructor(private readonly selfName: string) {}

  /**
   * The chat panel lists everything since the bot joined, so every scrape repeats earlier
   * messages. Identical messages are told apart by their order within one scrape, and a message
   * is stamped with the moment it was first seen.
   */
  observe(scraped: ChatMessage[], now: Date, offsetMs: number): void {
    const occurrences = new Map<string, number>();
    for (const message of scraped) {
      const base = keyOf(message, 0);
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      const key = keyOf(message, occurrence);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      if (message.sender === this.selfName || this.messages.length >= MAX_CHAT_MESSAGES) continue;
      this.messages.push({
        key,
        sender: message.sender.slice(0, MAX_CHAT_SENDER),
        text: message.text.slice(0, MAX_CHAT_TEXT),
        links: message.links
          .filter((link) => link.length <= MAX_CHAT_LINK)
          .slice(0, MAX_CHAT_LINKS),
        sentAt: now,
        offsetMs,
      });
    }
  }

  unsaved(): TrackedChat[] {
    return this.messages.slice(this.saved);
  }

  markSaved(count: number): void {
    this.saved += count;
  }
}
