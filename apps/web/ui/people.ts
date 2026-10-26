import type { PersonDto, PersonLineDto } from '../src/dto.js';

/** People whose name, email or notes contain the text, in the order given. */
export function filterPeople(people: readonly PersonDto[], query: string): PersonDto[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...people];
  return people.filter((person) =>
    [person.name, person.notes ?? '', ...person.emails].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validEmail = (email: string) => EMAIL.test(email);

/** Emails typed in a box: separated by commas, semicolons, spaces or new lines. Lower case, no doubles. */
export function parseEmails(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email !== ''),
    ),
  ];
}

/** How far a voice profile is, from the samples and the seconds of speech behind them. */
export const PROFILE_GOOD_SAMPLES = 5;
export const PROFILE_GOOD_SECONDS = 20;

export type ProfileLevel = 'none' | 'building' | 'good';

export function profileLevel(person: Pick<PersonDto, 'samples' | 'voiceSeconds'>): ProfileLevel {
  if (person.samples === 0) return 'none';
  return person.samples >= PROFILE_GOOD_SAMPLES && person.voiceSeconds >= PROFILE_GOOD_SECONDS
    ? 'good'
    : 'building';
}

export const profileLabels: Record<ProfileLevel, string> = {
  none: 'No voice profile',
  building: 'Voice profile in progress',
  good: 'Voice profile ready',
};

export function reasonLabel(
  line: Pick<PersonLineDto, 'reason' | 'speakerConfidence' | 'voiceScore'>,
) {
  const percent = (value: number) => `${String(Math.round(value * 100))}%`;
  switch (line.reason) {
    case 'suggested':
      return 'The speaker review suggests this person';
    case 'voice':
      return line.voiceScore === null
        ? 'The voice does not fit well'
        : `The voice fits ${percent(line.voiceScore)}, a weak match`;
    case 'uncertain':
      return line.speakerConfidence === null
        ? 'Speaker uncertain'
        : `Speaker uncertain: ${percent(line.speakerConfidence)}`;
    default:
      return '';
  }
}
