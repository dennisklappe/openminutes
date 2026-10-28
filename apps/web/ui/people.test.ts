import { describe, expect, it } from 'vitest';
import type { PersonDto } from '../src/dto.js';
import {
  filterPeople,
  mergePreview,
  parseEmails,
  barPercent,
  lengthLabel,
  missingHint,
  profileLevel,
  reasonLabel,
  reviewLabel,
  validEmail,
  varietyLabel,
} from './people.js';

const person = (name: string, extra: Partial<PersonDto> = {}): PersonDto => ({
  id: name,
  name,
  notes: null,
  emails: [],
  samples: 0,
  voiceSeconds: 0,
  needsReview: 0,
  meetings: 0,
  lastSeenAt: null,
  source: 'joined',
  tracking: 'on',
  duplicates: [],
  languages: [],
  unnamed: false,
  sharedAccount: null,
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

describe('profileLevel with readiness', () => {
  const language = (ready: boolean) => ({
    readiness: {
      length: 1,
      variety: 1,
      meetings: { have: 5, target: 5 },
      ways: { have: 5, target: 5 },
      ready,
    },
  });

  it('is good when one language is ready, building when none is', () => {
    const base = { samples: 9, voiceSeconds: 300 };
    expect(profileLevel({ ...base, languages: [language(false), language(true)] })).toBe('good');
    expect(profileLevel({ ...base, languages: [language(false)] })).toBe('building');
    expect(profileLevel({ samples: 0, voiceSeconds: 0, languages: [language(true)] })).toBe('none');
  });
});

describe('readiness labels', () => {
  const readiness = (extra = {}) => ({
    length: 0.7,
    variety: 0.6,
    meetings: { have: 3, target: 5 },
    ways: { have: 4, target: 5 },
    ready: false,
    ...extra,
  });

  it('writes the two bars', () => {
    expect(lengthLabel({ effectiveSeconds: 84.4, targetSeconds: 120 })).toBe('84 s of 120 s');
    expect(varietyLabel(readiness())).toBe('3 of 5 meetings, 4 of 5 ways of sounding');
    expect(barPercent(0.666)).toBe(67);
    expect(barPercent(1.4)).toBe(100);
    expect(barPercent(-1)).toBe(0);
  });

  it('says what is still missing', () => {
    const profile = { effectiveSeconds: 84, targetSeconds: 120, readiness: readiness() };
    expect(missingHint(profile)).toBe(
      'Needs 36 s more speech, 2 more meetings and 1 more way of sounding.',
    );
    expect(
      missingHint({
        effectiveSeconds: 130,
        targetSeconds: 120,
        readiness: readiness({ ways: { have: 4, target: 5 }, meetings: { have: 5, target: 5 } }),
      }),
    ).toBe('Needs 1 more way of sounding.');
    expect(missingHint({ ...profile, readiness: readiness({ ready: true }) })).toBe('');
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

describe('mergePreview', () => {
  it('keeps the chosen name and adds up emails and samples without doubles', () => {
    const keep = person('Dennis Klappe', { emails: ['d@x.com'], samples: 3 });
    const drop = person('Dennis', { emails: ['D@x.com', 'dennis@y.com'], samples: 2 });
    expect(mergePreview(keep, drop)).toEqual({
      name: 'Dennis Klappe',
      emails: ['d@x.com', 'dennis@y.com'],
      samples: 5,
      untracked: false,
    });
  });

  it('says the merged person is not tracked and has no samples when either one is not', () => {
    const preview = mergePreview(person('A', { samples: 4 }), person('B', { tracking: 'off' }));
    expect(preview).toMatchObject({ untracked: true, samples: 0 });
  });
});

describe('reviewLabel', () => {
  it('shows the session size against the total when capped', () => {
    expect(reviewLabel(1)).toBe('1 line');
    expect(reviewLabel(12)).toBe('12 lines');
    expect(reviewLabel(25)).toBe('25 lines');
    expect(reviewLabel(140)).toBe('25 of 140 lines');
  });
});
