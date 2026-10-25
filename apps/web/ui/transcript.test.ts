import { describe, expect, it } from 'vitest';
import type { ChatMessageDto, SegmentDto } from '../src/dto.js';
import { makeSegment } from './segment.fixture.js';
import { linkParts, mergeTranscript } from './transcript.js';

const segment = (id: string, startMs: number): SegmentDto =>
  makeSegment({ id, startMs, endMs: startMs + 1000 });

const message = (id: string, offsetMs: number): ChatMessageDto => ({
  id,
  sender: 'Alice',
  text: id,
  links: [],
  sentAt: '2026-10-22T10:00:00.000Z',
  offsetMs,
});

describe('mergeTranscript', () => {
  it('interleaves chat with segments by offset and keeps segments first on a tie', () => {
    const merged = mergeTranscript(
      [segment('s1', 0), segment('s2', 5000)],
      [message('c1', 2000), message('c2', 5000)],
    );
    expect(merged.map((entry) => `${entry.kind}:${entry.at}`)).toEqual([
      'segment:0',
      'chat:2000',
      'segment:5000',
      'chat:5000',
    ]);
  });

  it('returns only segments when there is no chat', () => {
    expect(mergeTranscript([segment('s1', 0)], [])).toHaveLength(1);
  });
});

describe('linkParts', () => {
  it('splits http and https links out of the text without their trailing punctuation', () => {
    expect(linkParts('See https://example.com/a?b=1, and http://x.test.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { kind: 'text', text: ', and ' },
      { kind: 'link', text: 'http://x.test', href: 'http://x.test/' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('never links other schemes', () => {
    expect(linkParts('javascript:alert(1) data:text/html,x ftp://a.test')).toEqual([
      { kind: 'text', text: 'javascript:alert(1) data:text/html,x ftp://a.test' },
    ]);
  });

  it('does not link a scheme hidden inside a longer word or markup', () => {
    const parts = linkParts('<a href="javascript:x">https://ok.test</a>');
    expect(parts.filter((part) => part.kind === 'link').map((part) => part.text)).toEqual([
      'https://ok.test',
    ]);
  });

  it('returns plain text unchanged', () => {
    expect(linkParts('hello')).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(linkParts('')).toEqual([]);
  });
});
