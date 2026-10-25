import type { ChatMessage } from '@openminutes/platforms';
import { describe, expect, it } from 'vitest';
import { ChatTracker, MAX_CHAT_MESSAGES, MAX_CHAT_SENDER, MAX_CHAT_TEXT } from './chat-tracker.js';

const message = (sender: string, text: string, time: string | null = '10:00 AM'): ChatMessage => ({
  sender,
  text,
  time,
  links: [],
});

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 22, 10, 0, seconds));

describe('ChatTracker', () => {
  it('keeps a message once however often it is scraped', () => {
    const tracker = new ChatTracker('Bot');
    const alice = message('Alice', 'hello');
    tracker.observe([alice], at(5), 5_000);
    tracker.observe([alice, message('Bob', 'hi')], at(10), 10_000);
    tracker.observe([alice, message('Bob', 'hi')], at(15), 15_000);
    expect(tracker.unsaved().map((m) => [m.sender, m.offsetMs])).toEqual([
      ['Alice', 5_000],
      ['Bob', 10_000],
    ]);
  });

  it('keeps identical messages sent twice by telling them apart by order', () => {
    const tracker = new ChatTracker('Bot');
    const ok = message('Alice', '+1');
    tracker.observe([ok], at(1), 1_000);
    tracker.observe([ok, ok], at(9), 9_000);
    tracker.observe([ok, ok], at(12), 12_000);
    expect(tracker.unsaved().map((m) => m.offsetMs)).toEqual([1_000, 9_000]);
  });

  it('treats the same text at another time as another message', () => {
    const tracker = new ChatTracker('Bot');
    tracker.observe(
      [message('Alice', 'ok', '10:00 AM'), message('Alice', 'ok', '10:05 AM')],
      at(1),
      1,
    );
    expect(tracker.unsaved()).toHaveLength(2);
  });

  it('ignores the bot own messages, including the join message', () => {
    const tracker = new ChatTracker('Bot');
    tracker.observe([message('Bot', 'I am a notetaker'), message('Alice', 'hi')], at(1), 1);
    tracker.observe([message('Bot', 'I am a notetaker'), message('Alice', 'hi')], at(2), 2);
    expect(tracker.unsaved().map((m) => m.sender)).toEqual(['Alice']);
  });

  it('hands out only what is not saved yet', () => {
    const tracker = new ChatTracker('Bot');
    tracker.observe([message('Alice', 'one')], at(1), 1);
    tracker.markSaved(tracker.unsaved().length);
    tracker.observe([message('Alice', 'one'), message('Alice', 'two')], at(2), 2);
    expect(tracker.unsaved().map((m) => m.text)).toEqual(['two']);
  });

  it('carries the links through', () => {
    const tracker = new ChatTracker('Bot');
    tracker.observe(
      [{ ...message('Alice', 'see https://example.com'), links: ['https://example.com'] }],
      at(1),
      1,
    );
    expect(tracker.unsaved()[0]?.links).toEqual(['https://example.com']);
  });

  it('caps what a guest can make it store', () => {
    const tracker = new ChatTracker('Bot');
    const huge = {
      ...message('x'.repeat(5_000), 'y'.repeat(100_000)),
      links: ['https://a.example'],
    };
    tracker.observe([huge], at(1), 1_000);
    const [stored] = tracker.unsaved();
    expect(stored?.sender).toHaveLength(MAX_CHAT_SENDER);
    expect(stored?.text).toHaveLength(MAX_CHAT_TEXT);

    const flood = Array.from({ length: MAX_CHAT_MESSAGES + 50 }, (_, i) => message('Eve', `m${i}`));
    tracker.observe(flood, at(2), 2_000);
    expect(tracker.unsaved()).toHaveLength(MAX_CHAT_MESSAGES);
  });
});
