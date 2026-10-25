import { describe, expect, it } from 'vitest';
import { parseSpeakerChanges, ReviewReplyError } from './speaker-review-reply.js';

const limits = (count = 5) => ({
  current: new Map(Array.from({ length: count }, (_, i) => [i + 10, 'Anna'] as [number, string])),
  speakers: new Set(['Anna', 'Bob']),
});

const reply = (...changes: [number, string][]) =>
  JSON.stringify({ changes: changes.map(([index, speaker]) => ({ index, speaker })) });

describe('parseSpeakerChanges', () => {
  it('returns the real changes and ignores prose and fences around the JSON', () => {
    const text = `Sure.\n\`\`\`json\n${reply([10, 'Bob'], [11, 'Anna'])}\n\`\`\``;
    expect(parseSpeakerChanges(text, limits())).toEqual([{ index: 10, speaker: 'Bob' }]);
  });

  it('accepts an empty list and ignores a text field the model adds', () => {
    expect(parseSpeakerChanges('{"changes":[]}', limits())).toEqual([]);
    const withText = '{"changes":[{"index":10,"speaker":"Bob","text":"other words"}]}';
    expect(parseSpeakerChanges(withText, limits())).toEqual([{ index: 10, speaker: 'Bob' }]);
  });

  it.each([
    ['not json', 'I think nothing changes'],
    ['broken json', '{"changes":['],
    ['no list', '{"edits":[]}'],
    ['an unknown line', reply([99, 'Bob'])],
    ['an unknown speaker', reply([10, 'Carol'])],
    ['a duplicate', reply([10, 'Bob'], [10, 'Bob'])],
    ['a float index', '{"changes":[{"index":10.5,"speaker":"Bob"}]}'],
  ])('rejects %s', (_, text) => {
    expect(() => parseSpeakerChanges(text, limits())).toThrow(ReviewReplyError);
  });

  it('rejects a reply that changes more than 60 percent of the batch', () => {
    const many = reply([10, 'Bob'], [11, 'Bob'], [12, 'Bob'], [13, 'Bob']);
    expect(() => parseSpeakerChanges(many, limits(5))).toThrow('too many');
    expect(parseSpeakerChanges(many, limits(7))).toHaveLength(4);
  });

  it('always allows two changes', () => {
    expect(parseSpeakerChanges(reply([10, 'Bob'], [11, 'Bob']), limits(2))).toHaveLength(2);
  });
});
