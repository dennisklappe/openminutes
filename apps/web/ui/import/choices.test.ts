import { describe, expect, it } from 'vitest';
import type { ImportMeetingDto, LinkableEventDto } from '../../src/dto.js';
import { eventLinks, eventsNear, isSelectable, selectableKeys } from './choices.js';

const meeting = (over: Partial<ImportMeetingDto> = {}): ImportMeetingDto => ({
  key: 'k1',
  title: 'Weekly planning',
  startedAt: '2026-10-01T09:00:00.000Z',
  durationMs: 3_600_000,
  attendees: 2,
  hasAudio: true,
  meeting: null,
  ...over,
});
const linked = (status: 'failed' | 'transcribed' | 'ended') => ({
  id: 'm1',
  status,
  error: null,
  progress: null,
});

describe('selection', () => {
  it('lets only new and failed meetings with a recording be picked', () => {
    expect(isSelectable(meeting())).toBe(true);
    expect(isSelectable(meeting({ meeting: linked('failed') }))).toBe(true);
    expect(isSelectable(meeting({ meeting: linked('transcribed') }))).toBe(false);
    expect(isSelectable(meeting({ meeting: linked('ended') }))).toBe(false);
    expect(isSelectable(meeting({ hasAudio: false }))).toBe(false);
    expect(
      selectableKeys([
        meeting({ key: 'a' }),
        meeting({ key: 'b', meeting: linked('transcribed') }),
        meeting({ key: 'c', hasAudio: false }),
      ]),
    ).toEqual(['a']);
  });
});

describe('linking to the calendar', () => {
  const event = (id: string, scheduledStart: string): LinkableEventDto => ({
    id,
    title: id,
    scheduledStart,
    status: 'skipped',
    location: null,
    people: 2,
    names: ['Jo Parker', 'Ann Lee'],
  });
  const events = [
    event('far', '2026-09-28T09:00:00.000Z'),
    event('near', '2026-10-01T09:10:00.000Z'),
    event('same-day', '2026-10-01T15:00:00.000Z'),
  ];

  it('offers the meetings within a day and a half, the closest first', () => {
    expect(eventsNear(events, meeting()).map((entry) => entry.id)).toEqual(['near', 'same-day']);
  });

  it('suggests the closest meeting when it is near enough, and each meeting once', () => {
    expect(eventLinks([meeting()], events, {})).toEqual({ k1: 'near' });
    expect(
      eventLinks(
        [meeting({ key: 'a' }), meeting({ key: 'b', startedAt: '2026-10-01T09:05:00.000Z' })],
        events,
        {},
      ),
    ).toEqual({ a: 'near' });
    expect(eventLinks([meeting({ startedAt: '2026-10-01T20:00:00.000Z' })], events, {})).toEqual(
      {},
    );
  });

  it('keeps what the user chose, including no link, and skips imported or audio-less ones', () => {
    expect(eventLinks([meeting()], events, { k1: 'same-day' })).toEqual({ k1: 'same-day' });
    expect(eventLinks([meeting()], events, { k1: null })).toEqual({});
    expect(eventLinks([meeting({ hasAudio: false })], events, {})).toEqual({});
    expect(eventLinks([meeting({ meeting: linked('ended') })], events, {})).toEqual({});
  });
});
