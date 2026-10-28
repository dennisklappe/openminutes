import { describe, expect, it } from 'vitest';
import {
  expectedInvitees,
  expectedPeople,
  nearestFirst,
  speakerHint,
  suggestEvent,
} from './link-pick.js';

const person = (email: string, declined = false) => ({ email, name: null, declined });

describe('expected people', () => {
  it('counts invitees who did not decline, once, without rooms or dismissed ones', () => {
    const invitees = [
      person('jo@acme.example'),
      person('JO@acme.example'),
      person('ann@acme.example', true),
      person('sam@acme.example'),
      person('room@resource.calendar.google.com'),
      person('lee@acme.example'),
    ];
    expect(expectedPeople(invitees)).toBe(3);
    expect(expectedPeople(invitees, ['Sam@acme.example'])).toBe(2);
    expect(expectedInvitees(invitees).map((invitee) => invitee.email)).toEqual([
      'jo@acme.example',
      'sam@acme.example',
      'lee@acme.example',
    ]);
  });

  it('is null without an invitation', () => {
    expect(expectedPeople(null)).toBeNull();
    expect(expectedPeople([person('ann@acme.example', true)])).toBeNull();
  });
});

describe('speaker hint', () => {
  it.each([
    [null, undefined],
    [1, undefined],
    [2, 2],
    [4, 4],
    [5, 5],
    [9, 5],
  ])('turns %s invited into %s', (people, hint) => {
    expect(speakerHint(people)).toBe(hint);
  });
});

describe('closest meeting', () => {
  const at = new Date('2026-10-20T10:00:00Z');
  const event = (id: string, start: string) => ({ id, scheduledStart: start });
  const events = [
    event('early', '2026-10-20T06:00:00Z'),
    event('before', '2026-10-20T09:00:00Z'),
    event('after', '2026-10-20T10:20:00Z'),
    event('late', '2026-10-20T11:00:00Z'),
  ];

  it('suggests the one closest to the recording that is near enough to be it', () => {
    expect(suggestEvent(events, at)?.id).toBe('after');
    expect(suggestEvent(events, new Date('2026-10-20T09:10:00Z'))?.id).toBe('before');
  });

  it('suggests nothing when every meeting is too far away', () => {
    expect(suggestEvent(events, new Date('2026-10-20T20:00:00Z'))).toBeUndefined();
    expect(suggestEvent(events, new Date('2026-10-19T08:00:00Z'))).toBeUndefined();
  });

  it('orders the meetings by distance, keeping all of them', () => {
    expect(nearestFirst(events, at).map((entry) => entry.id)).toEqual([
      'after',
      'before',
      'late',
      'early',
    ]);
  });
});
