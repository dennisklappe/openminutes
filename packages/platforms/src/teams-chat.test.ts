import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { toChatMessages } from './chat.js';
import type { DomNode } from './meet-dom.js';
import { parseTeamsChat, teamsChatSelectors } from './teams-chat.js';

function scrape(name: string) {
  const html = readFileSync(new URL(`../fixtures/teams/${name}.html`, import.meta.url), 'utf8');
  const { document } = parseHTML(html) as unknown as { document: DomNode };
  return toChatMessages(parseTeamsChat(document, teamsChatSelectors, 'OpenMinutes Notetaker'));
}

describe('parseTeamsChat', () => {
  it('carries the author over to follow-up messages and skips system messages', () => {
    const messages = scrape('chat-messages');
    expect(messages.map((m) => [m.sender, m.text])).toEqual([
      ['Alice Example', 'I will send the url in the chat'],
      ['Alice Example', 'Here it is: https://example.com/plan?a=1&b=2'],
      ['OpenMinutes Notetaker', 'Hi, I am the OpenMinutes notetaker and will take notes.'],
      ['Bob Example', 'Also https://example.org/notes, and javascript:alert(1)'],
    ]);
  });

  it('uses the datetime attribute when present, else the label or nothing', () => {
    expect(scrape('chat-messages').map((m) => m.time)).toEqual([
      '2026-10-22T10:02:11.000Z',
      null,
      '2026-10-22T10:03:00.000Z',
      '10:04 AM',
    ]);
  });

  it('links only http and https urls', () => {
    const messages = scrape('chat-messages');
    expect(messages[1]?.links).toEqual(['https://example.com/plan?a=1&b=2']);
    expect(messages[3]?.links).toEqual(['https://example.org/notes']);
  });

  it('returns nothing when the DOM no longer matches', () => {
    expect(scrape('chat-changed-dom')).toEqual([]);
  });
});
