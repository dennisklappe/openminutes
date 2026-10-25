import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { toChatMessages } from './chat.js';
import type { DomNode } from './meet-dom.js';
import { meetChatSelectors, parseMeetChat } from './meet-chat.js';

function scrape(name: string) {
  const html = readFileSync(new URL(`../fixtures/meet/${name}.html`, import.meta.url), 'utf8');
  const { document } = parseHTML(html) as unknown as { document: DomNode };
  return toChatMessages(parseMeetChat(document, meetChatSelectors, 'OpenMinutes Notetaker'));
}

describe('parseMeetChat', () => {
  it('reads sender, time and text of every message in a group', () => {
    const messages = scrape('chat-messages');
    expect(messages.map((m) => [m.sender, m.time, m.text])).toEqual([
      ['Alice Example', '10:02 AM', 'I will send the agenda in a moment'],
      ['Alice Example', '10:02 AM', 'Agenda: https://example.com/agenda?x=1&y=2.'],
      [
        'OpenMinutes Notetaker',
        '10:03 AM',
        'Hi, I am the OpenMinutes notetaker and will take notes.',
      ],
      [
        'Bob Example',
        '10:04 AM',
        'Plain text link too: see docs.example.org and http://example.net/a_(b)',
      ],
      ['Bob Example', '10:04 AM', 'Thanks!'],
    ]);
  });

  it('extracts links from anchors and plain text', () => {
    const messages = scrape('chat-messages');
    expect(messages[1]?.links).toEqual(['https://example.com/agenda?x=1&y=2']);
    expect(messages[3]?.links).toEqual(['http://example.net/a_(b']);
  });

  it('swaps "You" for the bot name', () => {
    expect(scrape('chat-messages').some((m) => m.sender === 'You')).toBe(false);
  });

  it('returns nothing when the DOM no longer matches', () => {
    expect(scrape('chat-changed-dom')).toEqual([]);
  });

  describe('recorded from a real call', () => {
    it('reads other people by name and the viewer as the bot, without the pin button text', () => {
      expect(scrape('chat-live').map((m) => [m.sender, m.time, m.text])).toEqual([
        ['Alice Example', '5:04 PM', 'Message from A to B'],
        [
          'OpenMinutes Notetaker',
          '5:04 PM',
          'Reply from B to A with a link https://example.org/x?y=1',
        ],
        ['Alice Example', '5:04 PM', 'Second message from A'],
      ]);
    });

    it('reads the link and does not count the pin button as a second message', () => {
      const messages = scrape('chat-live');
      expect(messages).toHaveLength(3);
      expect(messages[1]?.links).toEqual(['https://example.org/x?y=1']);
    });
  });
});
