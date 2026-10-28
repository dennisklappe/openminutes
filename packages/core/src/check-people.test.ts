import { describe, expect, it } from 'vitest';
import {
  assignVoices,
  companyHint,
  fillFromCalendar,
  SURE_MARGIN,
  SURE_SCORE,
  type CheckPerson,
  type CheckVoice,
} from './check-people.js';

const proto = (vector: number[], language = 'en') => ({ vector, samples: 3, language });
const person = (
  id: string,
  name: string,
  vector: number[],
  emails: string[] = [],
): CheckPerson => ({
  id,
  name,
  emails,
  prototypes: [proto(vector)],
});
const voice = (id: string, embedding: number[] | null): CheckVoice => ({ id, embedding });

const JO = person('jo', 'Jo Parker', [1, 0, 0]);
const ANN = person('ann', 'Ann Lee', [0, 1, 0]);

describe('assignVoices', () => {
  it('calls a clear fit sure and a weaker one probable', () => {
    const result = assignVoices(
      [voice('v1', [1, 0.05, 0]), voice('v2', [0, 0.6, 0.8])],
      [JO, ANN],
      'en',
    );
    expect(result.get('v1')).toMatchObject({ personId: 'jo', certainty: 'sure' });
    expect(result.get('v2')).toMatchObject({ personId: 'ann', certainty: 'probable' });
  });

  it('is only probable when the runner-up fits almost as well', () => {
    const close = person('sam', 'Sam Roe', [0.9, 0.3, 0]);
    const result = assignVoices([voice('v1', [1, 0.1, 0])], [JO, close], 'en');
    const match = result.get('v1');
    expect(match?.score).toBeGreaterThanOrEqual(SURE_SCORE);
    expect(match?.certainty).toBe('probable');
    expect(SURE_MARGIN).toBeGreaterThan(0);
  });

  it('gives nobody to a voice below the match threshold', () => {
    expect(assignVoices([voice('v1', [0, 0, 1])], [JO, ANN], 'en').size).toBe(0);
  });

  it('never gives one person to two voices, the better fit keeps them', () => {
    const result = assignVoices([voice('v1', [0.8, 0.3, 0]), voice('v2', [1, 0, 0])], [JO], 'en');
    expect(result.get('v2')?.personId).toBe('jo');
    expect(result.has('v1')).toBe(false);
  });

  it('skips voices without an embedding and people without a profile', () => {
    const bare: CheckPerson = { id: 'bare', name: 'Bare', emails: [], prototypes: [] };
    expect(assignVoices([voice('v1', null)], [JO], 'en').size).toBe(0);
    expect(assignVoices([voice('v1', [1, 0, 0])], [bare], 'en').size).toBe(0);
  });
});

describe('fillFromCalendar', () => {
  const attendees = [
    { name: 'Jo Parker', email: 'jo@parker.example' },
    { name: 'Ann Lee', email: 'ann@acme.example' },
  ];

  it('names the one voice left over when one attendee is left over', () => {
    const matched = new Map([['v1', { personId: 'jo' }]]);
    const people = [{ ...JO, emails: ['jo@parker.example'] }, ANN];
    expect(fillFromCalendar(['v1', 'v2'], matched, attendees, people)).toEqual(
      new Map([['v2', { name: 'Ann Lee', email: 'ann@acme.example' }]]),
    );
  });

  it('does not guess when several voices or several attendees are left', () => {
    expect(fillFromCalendar(['v1', 'v2'], new Map(), attendees, [])).toEqual(new Map());
    const matched = new Map([['v1', { personId: 'jo' }]]);
    const three = [...attendees, { name: 'Sam Roe', email: 'sam@acme.example' }];
    const people = [{ ...JO, emails: ['jo@parker.example'] }, ANN];
    expect(fillFromCalendar(['v1', 'v2'], matched, three, people).size).toBe(0);
  });
});

describe('companyHint', () => {
  const own = new Set(['mine.example']);

  it('reads the company from a work email domain', () => {
    expect(companyHint({ emails: ['ann@acme.example'], earlier: [], ownDomains: own })).toEqual({
      name: 'Acme',
      source: 'email',
    });
  });

  it('ignores free mail and your own domain', () => {
    expect(
      companyHint({ emails: ['jo@gmail.com', 'jo@mine.example'], earlier: [], ownDomains: own }),
    ).toBeUndefined();
  });

  it('falls back on the company of earlier meetings, the most common one', () => {
    expect(
      companyHint({
        emails: [],
        earlier: ['Acme', 'Acme', 'Globex', null],
        ownDomains: own,
      }),
    ).toEqual({ name: 'Acme', source: 'earlier' });
  });

  it('gives no company when earlier meetings tie', () => {
    expect(
      companyHint({ emails: [], earlier: ['Acme', 'Globex'], ownDomains: own }),
    ).toBeUndefined();
  });
});
