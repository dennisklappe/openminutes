import { describe, expect, it } from 'vitest';
import { buildMinutes, type MinutesSource } from './build.js';

const source = (overrides: Partial<MinutesSource> = {}): MinutesSource => ({
  meeting: {
    title: 'Sync',
    platform: 'meet',
    joinUrl: 'https://meet.google.com/abc-defg-hij',
    scheduledStart: new Date('2026-01-01T09:00:00Z'),
    startedAt: new Date('2026-01-01T09:02:00Z'),
    endedAt: new Date('2026-01-01T09:40:00Z'),
    location: null,
    invitees: [
      { email: 'anna@example.com', name: 'Anna de Vries', declined: false },
      { email: 'ben.carter@example.com', name: null, declined: false },
      { email: 'daan@example.com', name: 'Daan Jansen', declined: true },
      { email: 'eva@example.com', name: 'Eva Rossi', declined: false },
    ],
    ...overrides.meeting,
  },
  participants: [
    { displayName: 'Anna de Vries', email: null },
    { displayName: 'Ben Carter', email: null },
    { displayName: 'Guest Visitor', email: null },
    { displayName: 'OpenMinutes Notetaker', email: null },
  ],
  botName: 'OpenMinutes Notetaker',
  summary: '  ## Decisions\n- Ship it  ',
  segments: [{ startMs: 0, endMs: 1000, speaker: 'Anna de Vries', text: 'Hello' }],
  ...overrides,
});

describe('buildMinutes', () => {
  it('carries the chat along and defaults to none', () => {
    const chat = [{ sender: 'Bo', text: 'hi', links: [], offsetMs: 5 }];
    expect(buildMinutes(source({ chat })).chat).toEqual(chat);
    expect(buildMinutes(source()).chat).toEqual([]);
  });

  it('drops a Summary heading the model put in front, because the page has its own', () => {
    const summary = '## Summary\n\nWe shipped.\n\n## Decisions\n- Ship it';
    expect(buildMinutes(source({ summary })).summary).toBe(
      'We shipped.\n\n## Decisions\n- Ship it',
    );
    expect(buildMinutes(source({ summary: '# Samenvatting\nKlaar.' })).summary).toBe('Klaar.');
    expect(buildMinutes(source({ summary: '## Summary of risks\nNone.' })).summary).toBe(
      '## Summary of risks\nNone.',
    );
  });

  it('lists who was seen as attendees and unseen invitees as absent', () => {
    const minutes = buildMinutes(source());
    expect(minutes.attendees).toEqual([
      { name: 'Anna de Vries', email: 'anna@example.com' },
      { name: 'Ben Carter', email: 'ben.carter@example.com' },
      { name: 'Guest Visitor', email: null },
    ]);
    expect(minutes.absent).toEqual([
      { name: 'Daan Jansen', email: 'daan@example.com', declined: true },
      { name: 'Eva Rossi', email: 'eva@example.com', declined: false },
    ]);
  });

  it('matches participants to invitees by email too', () => {
    const minutes = buildMinutes(
      source({ participants: [{ displayName: 'Dee', email: 'DAAN@example.com' }] }),
    );
    expect(minutes.attendees).toEqual([{ name: 'Dee', email: 'DAAN@example.com' }]);
    expect(minutes.absent.map((p) => p.email)).not.toContain('daan@example.com');
  });

  it('shows the name used in the meeting next to a renamed participant', () => {
    const minutes = buildMinutes(
      source({
        participants: [
          { displayName: 'Anna', originalName: 'Anna de Vries', email: null },
          { displayName: 'Carla', originalName: 'Marketing Acme', email: null },
          { displayName: 'Ben Carter', originalName: 'Ben Carter', email: null },
        ],
      }),
    );
    expect(minutes.attendees).toEqual([
      { name: 'Anna', email: 'anna@example.com', joinedAs: 'Anna de Vries' },
      { name: 'Carla', email: null, joinedAs: 'Marketing Acme' },
      { name: 'Ben Carter', email: 'ben.carter@example.com' },
    ]);
    expect(minutes.absent.map((p) => p.email)).not.toContain('anna@example.com');
  });

  it('never lists the bot and removes duplicate participants', () => {
    const minutes = buildMinutes(
      source({
        participants: [
          { displayName: 'Anna de Vries', email: null },
          { displayName: 'anna  de vries', email: null },
          { displayName: 'openminutes notetaker', email: null },
        ],
      }),
    );
    expect(minutes.attendees.map((p) => p.name)).toEqual(['Anna de Vries']);
  });

  it('falls back to the calendar when nobody was scraped', () => {
    const minutes = buildMinutes(source({ participants: [] }));
    expect(minutes.attendees.map((p) => p.name)).toEqual([
      'Anna de Vries',
      'Ben Carter',
      'Eva Rossi',
    ]);
    expect(minutes.absent).toEqual([
      { name: 'Daan Jansen', email: 'daan@example.com', declined: true },
    ]);
  });

  it('handles meetings without calendar data', () => {
    const minutes = buildMinutes(
      source({ meeting: { ...source().meeting, invitees: null, startedAt: null } }),
    );
    expect(minutes.absent).toEqual([]);
    expect(minutes.startedAt).toBe('2026-01-01T09:00:00.000Z');
  });

  it('drops a location that is only the meeting link', () => {
    const base = source().meeting;
    expect(
      buildMinutes(source({ meeting: { ...base, location: `Join ${base.joinUrl}` } })).location,
    ).toBeNull();
    expect(buildMinutes(source({ meeting: { ...base, location: ' Room 4 ' } })).location).toBe(
      'Room 4',
    );
  });

  it('trims the summary and keeps the transcript', () => {
    const minutes = buildMinutes(source());
    expect(minutes.summary).toBe('## Decisions\n- Ship it');
    expect(minutes.transcript).toHaveLength(1);
    expect(buildMinutes(source({ summary: '  ' })).summary).toBeNull();
    expect(buildMinutes(source({ summary: '## Summary' })).summary).toBeNull();
  });
});

describe('buildMinutes for a phone recording', () => {
  it('has no link and no attendees, only the location', () => {
    const minutes = buildMinutes({
      meeting: {
        title: 'Garden plans',
        platform: 'recording',
        joinUrl: 'phone://x',
        scheduledStart: null,
        startedAt: new Date('2026-01-02T10:00:00Z'),
        endedAt: new Date('2026-01-02T10:30:00Z'),
        location: null,
        invitees: [{ email: 'a@b.c', name: 'A', declined: false }],
      },
      participants: [{ displayName: 'Speaker 1', email: null }],
      botName: 'OpenMinutes',
      summary: 'Notes',
      segments: [],
    });
    expect(minutes).toMatchObject({ joinUrl: '', location: 'Recorded on phone', attendees: [] });
  });

  it('counts a shared account renamed to an invitee as that invitee being there', () => {
    const minutes = buildMinutes(
      source({
        meeting: {
          ...source().meeting,
          invitees: [
            { email: 'carla.gonzalez@acme.example', name: 'Carla Gonzalez', declined: false },
          ],
        },
        participants: [{ displayName: 'Carla', originalName: 'Marketing Acme', email: null }],
      }),
    );
    expect(minutes.absent).toEqual([]);
    expect(minutes.attendees).toEqual([
      { name: 'Carla', email: 'carla.gonzalez@acme.example', joinedAs: 'Marketing Acme' },
    ]);
  });

  it('honours an explicit link and leaves the other invitee absent', () => {
    const minutes = buildMinutes(
      source({
        participants: [
          { displayName: 'Marketing', email: null, inviteeEmails: ['EVA@example.com'] },
        ],
      }),
    );
    expect(minutes.attendees[0]?.email).toBe('eva@example.com');
    expect(minutes.absent.map((p) => p.email)).not.toContain('eva@example.com');
  });

  it('leaves out invitees the owner removed from the list, in either case', () => {
    const base = source();
    const minutes = buildMinutes(
      source({ meeting: { ...base.meeting, dismissedInvitees: ['Daan@Example.com'] } }),
    );
    expect(minutes.absent.map((p) => p.name)).toEqual(['Eva Rossi']);
    expect(minutes.attendees.map((p) => p.name)).toEqual([
      'Anna de Vries',
      'Ben Carter',
      'Guest Visitor',
    ]);
  });
});
