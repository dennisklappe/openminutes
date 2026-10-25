import { describe, expect, it } from 'vitest';
import { chatParts, showsChat, urlsIn } from './chat.js';
import { demoMinutes } from './demo.js';

describe('chatParts', () => {
  it('links web addresses in the text and keeps trailing punctuation out of them', () => {
    expect(
      chatParts({
        sender: 'A',
        text: 'See https://example.com/a, and\nhttp://example.org.',
        links: [],
        offsetMs: 0,
      }),
    ).toEqual([
      { text: 'See ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: ', and ' },
      { text: 'http://example.org', href: 'http://example.org' },
      { text: '.' },
    ]);
  });

  it('appends links missing from the text and drops anything but http and https', () => {
    expect(
      chatParts({
        sender: 'A',
        text: 'Look at this javascript:alert(1) ftp://example.com/x',
        links: ['https://example.com/a', 'javascript:alert(1)', 'ftp://example.com/x'],
        offsetMs: 0,
      }),
    ).toEqual([
      { text: 'Look at this javascript:alert(1) ftp://example.com/x' },
      { text: ' ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
    ]);
  });
});

describe('urlsIn', () => {
  it('finds web links without trailing punctuation or markdown brackets', () => {
    expect(urlsIn('See [a](https://a.example/x) and https://b.example/y. ftp://c.example')).toEqual(
      ['https://a.example/x', 'https://b.example/y'],
    );
  });
});

describe('showsChat', () => {
  it('needs messages and an explicit opt-in', () => {
    expect(showsChat(demoMinutes, { includeChat: true })).toBe(true);
    expect(showsChat(demoMinutes, {})).toBe(false);
    expect(showsChat(demoMinutes, { includeChat: false })).toBe(false);
    expect(showsChat({ ...demoMinutes, chat: [] }, { includeChat: true })).toBe(false);
  });
});
