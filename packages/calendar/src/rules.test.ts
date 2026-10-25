import { describe, expect, it } from 'vitest';
import { shouldJoin } from './rules.js';
import type { CalendarEvent, ScheduledEvent } from './types.js';

const now = new Date('2026-01-01T10:00:00Z');
const account = 'me@acme.com';

function event(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'e1',
    cancelled: false,
    title: 'Sync',
    start: new Date('2026-01-01T11:00:00Z'),
    end: new Date('2026-01-01T12:00:00Z'),
    link: { platform: 'meet', url: 'https://meet.google.com/abc-defg-hij' },
    isOrganizer: false,
    declined: false,
    guests: ['colleague@acme.com'],
    location: null,
    invitees: [],
    seriesKey: null,
    ...overrides,
  };
}

describe('shouldJoin', () => {
  it('joins everything with the all rule', () => {
    expect(shouldJoin('all', event(), account, now)).toBe(true);
  });

  it('never joins with the never rule', () => {
    expect(shouldJoin('never', event({ isOrganizer: true }), account, now)).toBe(false);
  });

  it('joins only organised meetings with the organizer rule', () => {
    expect(shouldJoin('organizer', event({ isOrganizer: true }), account, now)).toBe(true);
    expect(shouldJoin('organizer', event(), account, now)).toBe(false);
  });

  describe('external rule', () => {
    it('ignores guests from the same organisation', () => {
      expect(shouldJoin('external', event(), account, now)).toBe(false);
      expect(shouldJoin('external', event({ guests: [] }), account, now)).toBe(false);
    });

    it('joins when a guest is from another domain', () => {
      const guests = ['colleague@acme.com', 'Client@Other.io'];
      expect(shouldJoin('external', event({ guests }), account, now)).toBe(true);
    });

    it('treats every other guest as external on a consumer domain', () => {
      expect(
        shouldJoin('external', event({ guests: ['friend@gmail.com'] }), 'me@gmail.com', now),
      ).toBe(true);
      expect(shouldJoin('external', event({ guests: ['me@gmail.com'] }), 'me@gmail.com', now)).toBe(
        false,
      );
    });
  });

  it.each([
    ['has no meeting link', event({ link: undefined })],
    ['was declined', event({ declined: true })],
    ['already ended', event({ end: new Date('2026-01-01T09:00:00Z') })],
  ])('skips an event that %s', (_name, candidate) => {
    expect(shouldJoin('all', candidate, account, now)).toBe(false);
  });

  it('skips cancelled events', () => {
    const cancelled: CalendarEvent = { id: 'e1', cancelled: true };
    expect(shouldJoin('all', cancelled, account, now)).toBe(false);
  });

  it('still joins an event that is in progress', () => {
    const running = event({ start: new Date('2026-01-01T09:30:00Z') });
    expect(shouldJoin('all', running, account, now)).toBe(true);
  });
});
