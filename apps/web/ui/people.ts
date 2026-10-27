import type { LanguageCoverageDto, PersonDto, PersonLineDto, TrackingFilter } from '../src/dto.js';

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
    case 'elimination':
      return 'By elimination: the voice fits nobody else in the meeting, and this person is the one left';
    case 'mixed':
      return 'Probably two speakers';
    case 'training':
      return 'The label looks right, a confirmed line adds to the voice profile';
    default:
      return '';
  }
}

export const trackingLabels: Record<TrackingFilter, string> = {
  tracked: 'Tracked people',
  all: 'Everyone, also not tracked',
  untracked: 'Only not tracked',
};

type MergeSide = Pick<PersonDto, 'name' | 'emails' | 'samples' | 'meetings' | 'tracking'>;

export interface MergePreview {
  name: string;
  emails: string[];
  samples: number;
  /** One of them is not tracked, so the merged person is too and no voice is kept. */
  untracked: boolean;
}

/** What the merged person will look like: the kept person with the emails and samples of both. */
export function mergePreview(keep: MergeSide, drop: MergeSide): MergePreview {
  const untracked = keep.tracking === 'off' || drop.tracking === 'off';
  return {
    name: keep.name,
    emails: [...new Set([...keep.emails, ...drop.emails].map((email) => email.toLowerCase()))],
    samples: untracked ? 0 : keep.samples + drop.samples,
    untracked,
  };
}

/** "45 s of 90 s" */
export const coverageText = (seconds: number, target: number) =>
  `${String(seconds)} s of ${String(target)} s`;

/** "42 s", "3 min": short spans of speech for a profile card. */
export const speechText = (seconds: number) =>
  seconds >= 120 ? `${String(Math.round(seconds / 60))} min` : `${String(seconds)} s`;

/** "42 s verified, 3 min auto" */
export const profileBreakdown = (profile: Pick<LanguageCoverageDto, 'seconds' | 'autoSeconds'>) =>
  profile.autoSeconds > 0
    ? `${speechText(profile.seconds)} verified, ${speechText(profile.autoSeconds)} auto`
    : `${speechText(profile.seconds)} verified`;

/** Lines in one review session, the same cap the server asks. */
const SESSION_LINES = 25;

/** What the review button says: "12 lines", or "25 of 140 lines" when a session is capped. */
export function reviewLabel(total: number): string {
  const noun = total === 1 ? 'line' : 'lines';
  return total > SESSION_LINES
    ? `${String(SESSION_LINES)} of ${String(total)} lines`
    : `${String(total)} ${noun}`;
}
