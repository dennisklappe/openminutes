import type { Platform } from '@openminutes/platforms';
import type { Page } from 'playwright-core';
import { ChatTracker, type TrackedChat } from './chat-tracker.js';

const CHAT_POLL_INTERVAL_MS = 2_000;
const CHAT_FLUSH_INTERVAL_MS = 30_000;

interface ChatScraperOptions {
  platform: Platform;
  page: Page;
  selfName: string;
  startedAt: Date;
  save: (messages: TrackedChat[]) => Promise<void>;
  pollIntervalMs?: number;
  flushIntervalMs?: number;
}

export interface ChatScraper {
  stop(): Promise<void>;
}

export function startChatScraper({
  platform,
  page,
  selfName,
  startedAt,
  save,
  pollIntervalMs = CHAT_POLL_INTERVAL_MS,
  flushIntervalMs = CHAT_FLUSH_INTERVAL_MS,
}: ChatScraperOptions): ChatScraper {
  const tracker = new ChatTracker(selfName);
  const state = { running: true };

  const flush = async () => {
    const pending = tracker.unsaved();
    if (pending.length === 0) return;
    try {
      await save(pending);
      tracker.markSaved(pending.length);
    } catch (error) {
      console.error('chat messages could not be saved yet, will retry', error);
    }
  };

  const poll = async () => {
    try {
      const now = new Date();
      const scraped = await platform.scrapeChat(page, selfName);
      tracker.observe(scraped, now, now.getTime() - startedAt.getTime());
    } catch {
      // The page may be navigating or closing, the next poll or the watch loop will tell.
    }
  };

  const loop = (async () => {
    let lastFlush = Date.now();
    while (state.running) {
      await poll();
      if (Date.now() - lastFlush >= flushIntervalMs) {
        lastFlush = Date.now();
        await flush();
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  })();

  return {
    async stop() {
      state.running = false;
      await loop;
      await poll();
      await flush();
    },
  };
}
