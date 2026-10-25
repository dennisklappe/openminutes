import { describe, expect, it } from 'vitest';
import { addDueDates, describeMeetingDate } from './due-dates.js';

const table = (due: string) =>
  `## Action items\n\n| Owner | Action | Due |\n| --- | --- | --- |\n| Ann | Send it | ${due} |`;
const due = (value: string, date: string, timeZone?: string) =>
  addDueDates(table(value), { date: new Date(date), timeZone }).split('\n')[4];
const row = (value: string) => `| Ann | Send it | ${value} |`;

describe('addDueDates', () => {
  it('adds the date to an English weekday', () => {
    expect(due('Wednesday', '2026-11-09T10:00:00Z')).toBe(row('Wednesday (11 Nov)'));
    expect(due('by Friday', '2026-02-26T10:00:00Z')).toBe(row('by Friday (27 Feb)'));
  });

  it('handles tomorrow and keeps a trailing part of the day', () => {
    expect(due('tomorrow morning', '2026-12-31T10:00:00Z')).toBe(row('tomorrow (1 Jan) morning'));
    expect(due('Today', '2026-10-22T10:00:00Z')).toBe(row('Today (22 Oct)'));
  });

  it('resolves next weekday into the following week', () => {
    expect(due('next Monday', '2026-11-11T10:00:00Z')).toBe(row('next Monday (16 Nov)'));
    expect(due('next Monday', '2026-11-08T10:00:00Z')).toBe(row('next Monday (9 Nov)'));
    expect(due('next Wednesday', '2026-11-09T10:00:00Z')).toBe(row('next Wednesday (18 Nov)'));
  });

  it('keeps Dutch words and uses Dutch month names', () => {
    expect(due('woensdag', '2026-11-09T10:00:00Z')).toBe(row('woensdag (11 nov)'));
    expect(due('morgen', '2026-03-05T10:00:00Z')).toBe(row('morgen (6 mrt)'));
    expect(due('volgende maandag', '2026-05-27T10:00:00Z')).toBe(row('volgende maandag (1 jun)'));
    expect(due('morgenochtend', '2026-05-27T10:00:00Z')).toBe(row('morgenochtend (28 mei)'));
  });

  it('uses the meeting date in the given time zone', () => {
    expect(due('tomorrow', '2026-11-09T23:30:00Z', 'Europe/Amsterdam')).toBe(
      row('tomorrow (11 Nov)'),
    );
    expect(due('tomorrow', '2026-11-09T23:30:00Z', 'America/New_York')).toBe(
      row('tomorrow (10 Nov)'),
    );
  });

  it('leaves dated, ambiguous and unrelated values unchanged', () => {
    for (const value of [
      'Wednesday (12 Nov)',
      '12 Nov',
      'Not specified',
      'Monday or Tuesday',
      'next week Friday',
      'every Monday',
      'Tuesday',
    ]) {
      expect(due(value, '2026-11-10T10:00:00Z')).toBe(row(value));
    }
  });

  it('only touches the Due column of a table', () => {
    const text =
      'Friday we met.\n\n| Owner | Action | Due |\n| --- | --- | --- |\n| Ann | Call on Friday | Not specified |';
    expect(addDueDates(text, { date: new Date('2026-11-10T10:00:00Z') })).toBe(text);
  });
});

describe('describeMeetingDate', () => {
  it('names the weekday, date and zone', () => {
    expect(
      describeMeetingDate({ date: new Date('2026-11-09T23:30:00Z'), timeZone: 'Europe/Amsterdam' }),
    ).toBe('Tuesday 10 Nov 2026 (time zone Europe/Amsterdam)');
  });
});
