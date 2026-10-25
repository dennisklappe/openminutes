import { describe, expect, it } from 'vitest';
import { extractLinks, toChatMessages } from './chat.js';

describe('extractLinks', () => {
  it('finds urls in text and anchors, trims trailing punctuation and dedupes', () => {
    expect(
      extractLinks('See https://example.com/a, and (http://example.org/b). https://example.com/a', [
        'https://example.com/a',
      ]),
    ).toEqual(['https://example.com/a', 'http://example.org/b']);
  });

  it('keeps only http and https links', () => {
    expect(
      extractLinks('javascript:alert(1) ftp://example.com/x', [
        'javascript:alert(1)',
        'mailto:a@example.com',
        '/relative',
      ]),
    ).toEqual([]);
  });

  it('keeps query strings and balanced paths', () => {
    expect(extractLinks('https://example.com/a?x=1&y=2')).toEqual([
      'https://example.com/a?x=1&y=2',
    ]);
  });
});

describe('toChatMessages', () => {
  it('drops messages without a sender or text and trims the text', () => {
    expect(
      toChatMessages([
        { sender: 'Alice', text: '  hi  ', time: '10:00', hrefs: [] },
        { sender: '', text: 'orphan', time: null, hrefs: [] },
        { sender: 'Bob', text: '   ', time: null, hrefs: [] },
      ]),
    ).toEqual([{ sender: 'Alice', text: 'hi', time: '10:00', links: [] }]);
  });
});
