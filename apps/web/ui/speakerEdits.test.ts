import { describe, expect, it } from 'vitest';
import { makeSegment } from './segment.fixture.js';
import {
  editMessage,
  neighbours,
  otherSpeaker,
  scopeChoices,
  scopeIds,
  splitParts,
  splitWords,
  uncertaintyLabel,
} from './speakerEdits.js';

const line = (id: string, speakerId: string | null, confidence: number | null = null) =>
  makeSegment({ id, speakerId, speaker: speakerId, speakerConfidence: confidence });

const dialog = [line('a', 'x'), line('b', 'y'), line('c', 'y'), line('d', 'y'), line('e', 'x')];

describe('scopeIds', () => {
  it('limits to the line, the rest of the block or the whole block', () => {
    expect(scopeIds(dialog, 'c', 'line')).toEqual(['c']);
    expect(scopeIds(dialog, 'c', 'following')).toEqual(['c', 'd']);
    expect(scopeIds(dialog, 'c', 'block')).toEqual(['b', 'c', 'd']);
  });

  it('is empty for an unknown line', () => {
    expect(scopeIds(dialog, 'zzz', 'block')).toEqual([]);
  });
});

describe('scopeChoices', () => {
  it('offers only scopes that reach more lines', () => {
    expect(scopeChoices(dialog, 'a')).toEqual(['line']);
    expect(scopeChoices(dialog, 'd')).toEqual(['line', 'block']);
    expect(scopeChoices(dialog, 'c')).toEqual(['line', 'following', 'block']);
  });
});

describe('neighbours', () => {
  it('finds adjacent segments and null at the edges', () => {
    expect(neighbours(dialog, 'a')).toEqual({ previous: null, next: dialog[1] });
    expect(neighbours(dialog, 'e').next).toBeNull();
  });
});

describe('split helpers', () => {
  it('splits text on any whitespace and rejoins both halves', () => {
    const words = splitWords('  Dat  klopt,\nik bel je terug ');
    expect(words).toEqual(['Dat', 'klopt,', 'ik', 'bel', 'je', 'terug']);
    expect(splitParts(words, 2)).toEqual(['Dat klopt,', 'ik bel je terug']);
  });

  it('defaults the second half to another known speaker, else a new one', () => {
    expect(
      otherSpeaker(
        [
          { id: 'x', name: 'A' },
          { id: 'y', name: 'B' },
        ],
        'x',
      ),
    ).toEqual({ id: 'y' });
    expect(otherSpeaker([{ id: 'x', name: 'A' }], 'x')).toEqual({ create: true });
  });
});

describe('labels', () => {
  it('rounds the confidence to a percent', () => {
    expect(uncertaintyLabel(line('a', 'x', 0.624))).toBe('Speaker uncertain: 62%');
    expect(uncertaintyLabel(line('a', 'x'))).toBe('Speaker uncertain');
  });

  it('describes each kind of edit', () => {
    expect(editMessage({ kind: 'split', segmentId: 'a', wordIndex: 1 })).toBe('Line split.');
    expect(editMessage({ kind: 'merge', segmentIds: ['a', 'b'] })).toBe('Lines merged.');
    expect(editMessage({ kind: 'revert', segmentIds: ['a'] })).toBe('Speaker changed.');
  });
});
