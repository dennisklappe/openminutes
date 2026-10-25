import { describe, expect, it } from 'vitest';
import { availableParts, noParts, partsLabel, samePartsAs } from './parts.js';

describe('partsLabel', () => {
  it('names the minutes and what comes with them', () => {
    expect(partsLabel(noParts)).toBe('Minutes');
    expect(partsLabel({ ...noParts, includeTranscript: true })).toBe('Minutes + transcript');
    expect(partsLabel({ includeTranscript: true, includeChat: true, includeLinks: true })).toBe(
      'Minutes + transcript + chat + links',
    );
    expect(partsLabel({ ...noParts, includeChat: true })).toBe('Minutes + chat');
  });
});

describe('parts helpers', () => {
  it('compares parts', () => {
    expect(samePartsAs(noParts, { ...noParts })).toBe(true);
    expect(samePartsAs(noParts, { ...noParts, includeLinks: true })).toBe(false);
  });

  it('turns off what the meeting cannot offer', () => {
    const all = { includeTranscript: true, includeChat: true, includeLinks: true };
    expect(availableParts(all, { transcript: true, chat: false, links: false })).toEqual({
      includeTranscript: true,
      includeChat: false,
      includeLinks: false,
    });
  });
});
