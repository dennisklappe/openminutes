import { describe, expect, it } from 'vitest';
import { makeSegment } from './segment.fixture.js';
import { stepUncertain, uncertainSegments } from './speakerReview.js';

const segments = ['a', 'b*', 'c', 'd*', 'e'].map((id) =>
  makeSegment({ id: id.replace('*', ''), uncertain: id.endsWith('*') }),
);

describe('stepUncertain', () => {
  it('starts at the first or last uncertain line without a cursor', () => {
    expect(stepUncertain(segments, null, 1)).toBe('b');
    expect(stepUncertain(segments, null, -1)).toBe('d');
  });

  it('moves relative to the cursor, also when the cursor line is no longer uncertain', () => {
    expect(stepUncertain(segments, 'b', 1)).toBe('d');
    expect(stepUncertain(segments, 'c', 1)).toBe('d');
    expect(stepUncertain(segments, 'c', -1)).toBe('b');
    expect(stepUncertain(segments, 'd', -1)).toBe('b');
  });

  it('wraps around', () => {
    expect(stepUncertain(segments, 'd', 1)).toBe('b');
    expect(stepUncertain(segments, 'b', -1)).toBe('d');
  });

  it('returns null when nothing is uncertain', () => {
    expect(
      stepUncertain(
        segments.filter((s) => !s.uncertain),
        null,
        1,
      ),
    ).toBeNull();
  });
});

describe('uncertainSegments', () => {
  it('keeps only the uncertain lines', () => {
    expect(uncertainSegments(segments).map((s) => s.id)).toEqual(['b', 'd']);
  });
});
