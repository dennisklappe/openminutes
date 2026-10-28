import type {
  EmailConflictDto,
  LanguageCoverageDto,
  PersonDto,
  PersonLineDto,
  ReadinessDto,
  TrackingFilter,
} from '../src/dto.js';

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

/** The old rule, kept for people whose languages carry no readiness data. */
export const PROFILE_GOOD_SAMPLES = 5;
export const PROFILE_GOOD_SECONDS = 20;

export type ProfileLevel = 'none' | 'building' | 'good';

/**
 * How far a person's voice profile is. With readiness per language, good means at least one
 * language is ready; without it the samples and seconds decide.
 */
export function profileLevel(
  person: Pick<PersonDto, 'samples' | 'voiceSeconds'> & {
    languages?: readonly Pick<LanguageCoverageDto, 'readiness'>[];
  },
): ProfileLevel {
  if (person.samples === 0) return 'none';
  const known = person.languages ?? [];
  if (known.length > 0)
    return known.some((profile) => profile.readiness.ready) ? 'good' : 'building';
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

/** The width of a bar for a share from 0 to 1, as a whole percent. */
export const barPercent = (share: number) => Math.round(100 * Math.min(1, Math.max(0, share)));

/** "84 s of 120 s", the Length bar of a voice profile. */
export const lengthLabel = (
  profile: Pick<LanguageCoverageDto, 'effectiveSeconds' | 'targetSeconds'>,
) => coverageText(Math.round(profile.effectiveSeconds), profile.targetSeconds);

/** "3 of 5 meetings, 4 of 5 ways of sounding", the Variety bar of a voice profile. */
export const varietyLabel = (readiness: Pick<ReadinessDto, 'meetings' | 'ways'>) =>
  `${String(readiness.meetings.have)} of ${String(readiness.meetings.target)} meetings, ${String(readiness.ways.have)} of ${String(readiness.ways.target)} ways of sounding`;

/** What a profile that is not ready still lacks, such as "36 s more speech and 2 more meetings". */
export function missingHint(
  profile: Pick<LanguageCoverageDto, 'effectiveSeconds' | 'targetSeconds' | 'readiness'>,
): string {
  const { readiness } = profile;
  if (readiness.ready) return '';
  const parts: string[] = [];
  const seconds = Math.ceil(profile.targetSeconds - profile.effectiveSeconds);
  if (seconds > 0) parts.push(`${String(seconds)} s more speech`);
  const meetings = readiness.meetings.target - readiness.meetings.have;
  if (meetings > 0)
    parts.push(`${String(meetings)} more ${meetings === 1 ? 'meeting' : 'meetings'}`);
  const ways = readiness.ways.target - readiness.ways.have;
  if (ways > 0) parts.push(`${String(ways)} more ${ways === 1 ? 'way' : 'ways'} of sounding`);
  if (parts.length === 0) return 'Almost there.';
  const last = parts.pop();
  return `Needs ${parts.length > 0 ? `${parts.join(', ')} and ` : ''}${String(last)}.`;
}

/** The conflict an API error carries when an address belongs to another person. */
export function emailConflictOf(error: unknown): EmailConflictDto | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code, body } = error as { code?: unknown; body?: unknown };
  if (code !== 'email_taken' || typeof body !== 'object' || body === null) return undefined;
  const conflict = (body as { conflict?: EmailConflictDto }).conflict;
  return conflict && typeof conflict.personId === 'string' ? conflict : undefined;
}

export const conflictMergeLabel = (conflict: EmailConflictDto): string =>
  `Merge ${conflict.name} into ${conflict.into?.name ?? 'this person'}`;

/** A light hint where the other person came from, when they are only a guess from an invitation. */
export const conflictOrigin = (conflict: EmailConflictDto): string | undefined =>
  conflict.source === 'invited' || conflict.unnamed ? 'created from an invitation' : undefined;

export const conflictMessage = (conflict: EmailConflictDto): string =>
  `${conflict.email} already belongs to ${conflict.name}${
    conflictOrigin(conflict) ? ` (${conflictOrigin(conflict) ?? ''})` : ''
  }. Are they the same person?`;

export const conflictEffect = (conflict: EmailConflictDto): string =>
  `The name, emails, notes, voice samples and meetings of ${conflict.name} move to ${
    conflict.into?.name ?? 'this person'
  }, and ${conflict.name} is removed. This cannot be undone.`;
