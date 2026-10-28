import { describe, expect, it } from 'vitest';
import { buildReviewRoute, parseReviewRoute } from './reviewRoute.js';

describe('review routes', () => {
  it('parses the entry forms the app already links to', () => {
    expect(parseReviewRoute('/people/review')).toEqual({});
    expect(parseReviewRoute('/people/abc-1/review')).toEqual({ personId: 'abc-1' });
    expect(parseReviewRoute('/meetings/m-9/review')).toEqual({ meetingId: 'm-9' });
    expect(parseReviewRoute('/people/abc-1')).toBeUndefined();
    expect(parseReviewRoute('/people')).toBeUndefined();
  });

  it('parses a card with its scope and order from the query', () => {
    expect(parseReviewRoute('/people/review/l1?personId=p1&meetingId=m1&order=uncertain')).toEqual({
      lineId: 'l1',
      personId: 'p1',
      meetingId: 'm1',
      order: 'uncertain',
    });
    expect(parseReviewRoute('/people/p1/review/l2')).toEqual({ personId: 'p1', lineId: 'l2' });
    expect(parseReviewRoute('/meetings/m1/review/l3?order=newest')).toEqual({
      meetingId: 'm1',
      lineId: 'l3',
      order: 'newest',
    });
  });

  it('ignores a bad order or scope', () => {
    expect(parseReviewRoute('/people/review?order=sideways&personId=a%20b')).toEqual({});
  });

  it('builds addresses that parse back to the same thing', () => {
    for (const route of [
      {},
      { lineId: 'l1' },
      { personId: 'p1', lineId: 'l1' },
      { meetingId: 'm1', order: 'uncertain' as const, lineId: 'l1' },
      { personId: 'p1', meetingId: 'm1' },
    ]) {
      expect(parseReviewRoute(buildReviewRoute(route))).toEqual(route);
    }
    expect(buildReviewRoute({ personId: 'p1', order: 'newest', lineId: 'l1' })).toBe(
      '/people/p1/review/l1',
    );
    expect(buildReviewRoute({ personId: 'p1', meetingId: 'm1', lineId: 'l1' })).toBe(
      '/people/review/l1?personId=p1&meetingId=m1',
    );
    expect(buildReviewRoute({ meetingId: 'm1', order: 'uncertain' })).toBe(
      '/meetings/m1/review?order=uncertain',
    );
  });
});

describe('voice card routes', () => {
  it('parses a voice card in every scope', () => {
    expect(parseReviewRoute('/people/review/voice/v1')).toEqual({ voiceId: 'v1' });
    expect(parseReviewRoute('/people/p1/review/voice/v1')).toEqual({
      personId: 'p1',
      voiceId: 'v1',
    });
    expect(parseReviewRoute('/meetings/m1/review/voice/v1?order=uncertain')).toEqual({
      meetingId: 'm1',
      voiceId: 'v1',
      order: 'uncertain',
    });
    expect(parseReviewRoute('/people/review/voice')).toEqual({ lineId: 'voice' });
  });

  it('builds voice addresses that parse back', () => {
    expect(buildReviewRoute({ voiceId: 'v1' })).toBe('/people/review/voice/v1');
    for (const route of [
      { voiceId: 'v1' },
      { personId: 'p1', voiceId: 'v1' },
      { personId: 'p1', meetingId: 'm1', order: 'uncertain' as const, voiceId: 'v1' },
    ]) {
      expect(parseReviewRoute(buildReviewRoute(route))).toEqual(route);
    }
  });
});
