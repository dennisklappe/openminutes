import type { ChatMessage, Platform } from '@openminutes/platforms';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { startChatScraper } from './chat-scraper.js';
import type { TrackedChat } from './chat-tracker.js';

const chat = (...texts: string[]): ChatMessage[] =>
  texts.map((text) => ({ sender: 'Alice', text, time: null, links: [] }));

function fakePlatform(read: () => ChatMessage[]): Platform {
  return { scrapeChat: () => Promise.resolve(read()) } as unknown as Platform;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('startChatScraper', () => {
  it('saves new messages periodically and the rest when stopped', async () => {
    let visible = chat('one');
    const saved: TrackedChat[][] = [];
    const scraper = startChatScraper({
      platform: fakePlatform(() => visible),
      page: {} as Page,
      selfName: 'Bot',
      startedAt: new Date(),
      save: (messages) => {
        saved.push(messages);
        return Promise.resolve();
      },
      pollIntervalMs: 5,
      flushIntervalMs: 20,
    });
    await wait(60);
    visible = chat('one', 'two');
    await scraper.stop();
    expect(saved.flat().map((m) => m.text)).toEqual(['one', 'two']);
  });

  it('retries saving after a failure and survives a failing scrape', async () => {
    let attempts = 0;
    const saved: string[] = [];
    let calls = 0;
    const platform = {
      scrapeChat: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('navigating')) : Promise.resolve(chat('one'));
      },
    } as unknown as Platform;
    const scraper = startChatScraper({
      platform,
      page: {} as Page,
      selfName: 'Bot',
      startedAt: new Date(),
      save: (messages) => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('db down'));
        saved.push(...messages.map((m) => m.text));
        return Promise.resolve();
      },
      pollIntervalMs: 5,
      flushIntervalMs: 10,
    });
    await wait(60);
    await scraper.stop();
    expect(saved).toEqual(['one']);
  });
});
