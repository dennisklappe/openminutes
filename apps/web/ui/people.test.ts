import { describe, expect, it } from 'vitest';
import type { PersonDto } from '../src/dto.js';
import { filterPeople, parseEmails, profileLevel, reasonLabel, validEmail } from './people.js';

const person = (name: string, extra: Partial<PersonDto> = {}): PersonDto => ({
  id: name,
  name,
  notes: null,
  emails: [],
  samples: 0,
  voiceSeconds: 0,
  needsReview: 0,
  meetings: 0,
  ...extra,
});

describe('filterPeople', () => {
  const list = [
    person('Anna Synthetic', { emails: ['anna@example.com', 'a.s@example.org'] }),
    person('Bram Fixture', { notes: 'Works with Anna' }),
    person('Cleo'),
  ];

  it('finds by name, any email and notes, ignoring case', () => {
    expect(filterPeople(list, 'ANNA').map((p) => p.name)).toEqual([
      'Anna Synthetic',
      'Bram Fixture',
    ]);
    expect(filterPeople(list, 'example.org').map((p) => p.name)).toEqual(['Anna Synthetic']);
  });

  it('returns everyone for a blank search', () => {
    expect(filterPeople(list, '  ')).toHaveLength(3);
  });
});

describe('parseEmails', () => {
  it('splits on commas, spaces and lines, lower cases and drops doubles', () => {
    expect(parseEmails('A@x.com, b@x.com;\na@X.com  c@x.com')).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ]);
    expect(parseEmails('')).toEqual([]);
  });

  it('checks the shape of an address', () => {
    expect(validEmail('a@x.com')).toBe(true);
    expect(validEmail('a@x')).toBe(false);
    expect(validEmail('a b@x.com')).toBe(false);
  });
});

describe('profileLevel', () => {
  it('is none without samples, building until five samples and twenty seconds', () => {
    expect(profileLevel({ samples: 0, voiceSeconds: 0 })).toBe('none');
    expect(profileLevel({ samples: 4, voiceSeconds: 60 })).toBe('building');
    expect(profileLevel({ samples: 5, voiceSeconds: 19 })).toBe('building');
    expect(profileLevel({ samples: 5, voiceSeconds: 20 })).toBe('good');
  });
});

describe('reasonLabel', () => {
  it('explains why a line needs a look', () => {
    expect(reasonLabel({ reason: 'uncertain', speakerConfidence: 0.42, voiceScore: null })).toBe(
      'Speaker uncertain: 42%',
    );
    expect(reasonLabel({ reason: 'voice', speakerConfidence: 0.9, voiceScore: 0.31 })).toContain(
      '31%',
    );
    expect(reasonLabel({ reason: null, speakerConfidence: null, voiceScore: null })).toBe('');
  });
});
