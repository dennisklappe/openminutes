export type PersonSource = 'manual' | 'joined' | 'invited';

export interface PersonDto {
  id: string;
  name: string;
  notes: string | null;
  /** None, one or several. */
  emails: string[];
  /** Verified samples in the voice profile. */
  samples: number;
  /** Seconds of clean speech those samples cover. */
  voiceSeconds: number;
  /**
   * Lines worth a look, as the review queue counts them: doubtful lines plus as many training
   * lines as the voice profile still needs to be good enough. Not every unsure line.
   */
  needsReview: number;
  /** Meetings they were in or were invited to. */
  meetings: number;
  /** The newest of those meetings, an ISO date. */
  lastSeenAt: string | null;
  /** Added by hand, was in a meeting, or only on an invitation. */
  source: PersonSource;
  /** Off: no voice is learned or suggested for them, their name stays in transcripts. */
  tracking: 'on' | 'off';
  /** Other people who are probably the same person. Never merged on its own. */
  duplicates: PersonChoiceDto[];
  /** One voice profile per language, the most speech first. */
  languages: LanguageCoverageDto[];
  /** Nobody gave this voice of a shared account a name yet. */
  unnamed: boolean;
  /** The shared account this person was heard in, such as "Ann and Sam". */
  sharedAccount: string | null;
}

/** The readiness bars of one voice profile. All shares run from 0 to 1. */
export interface ReadinessDto {
  /** Clean speech against the target seconds. */
  length: number;
  /** The weaker of meetings and ways of sounding against their targets. */
  variety: number;
  meetings: { have: number; target: number };
  ways: { have: number; target: number };
  ready: boolean;
}

/** How far one voice profile, a person in one language, is. */
export interface LanguageCoverageDto {
  /** Two letter code, 'und' when the language is not known. */
  language: string;
  languageName: string;
  /** Samples a person confirmed. */
  samples: number;
  /** Seconds of clean verified speech. */
  seconds: number;
  /** Samples the voice added by itself from near-certain lines, and their seconds. */
  autoSamples: number;
  autoSeconds: number;
  /** Verified seconds plus the part of the auto seconds that counts, what the target is held against. */
  effectiveSeconds: number;
  /** The seconds that fill the Length bar (the Voices setting). */
  targetSeconds: number;
  /** The two bars of the profile. Ready means 100% on both. */
  readiness: ReadinessDto;
  /** Where the auto samples come from, to remove them per meeting. */
  autoMeetings: { meetingId: string; title: string; seconds: number }[];
}

export type PeopleSort = 'name' | 'meetings' | 'lastSeen';
export type PeopleFilter = 'all' | 'joined' | 'invited' | 'unnamed';
/** tracked: the default, without people marked do not track. */
export type TrackingFilter = 'tracked' | 'all' | 'untracked';

export interface PeopleQuery {
  q?: string | undefined;
  sort?: PeopleSort | undefined;
  dir?: 'asc' | 'desc' | undefined;
  /** joined: everyone who was in a meeting or added by hand. invited: only invited so far. */
  source?: PeopleFilter | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  tracking?: TrackingFilter | undefined;
}

export interface PeopleDto {
  people: PersonDto[];
  /** Everyone matching the search and filter, across all pages. */
  total: number;
  /** The same count across everyone, not only this page. */
  needsReview: number;
  /** The part of those one review session asks, at most 25. */
  reviewable: number;
  /** Tracked people who were only ever invited, whatever the filter. */
  invitedOnly: number;
  page: number;
  pageSize: number;
  /** Voices are learned from lines a person verified. */
  learning: boolean;
  /** Lines are checked against the saved voices. */
  checking: boolean;
}

/**
 * mixed: the voice guard thinks the line holds two speakers.
 * elimination: the voice fits nobody with a saved voice and this person is the one left.
 */
export type PersonLineReason =
  'uncertain' | 'suggested' | 'voice' | 'training' | 'elimination' | 'mixed';

export interface PersonLineDto {
  id: string;
  meetingId: string;
  meetingTitle: string;
  startMs: number;
  endMs: number;
  text: string;
  /** What the labelling is sure of, 0 to 1. */
  speakerConfidence: number | null;
  /** The voice check score against this person's profile, when there is one. */
  voiceScore: number | null;
  /** Why it is in the review list, null for a verified line. */
  reason: PersonLineReason | null;
  /** A person confirmed that this line is this person. */
  verified: boolean;
  /** The line is part of the voice profile. */
  inProfile: boolean;
  /** The language spoken, a two letter code or 'und'. */
  language: string;
  hasAudio: boolean;
  /** The shared account the line was heard in, such as "Ann and Sam". */
  sharedVia?: string | null;
}

export interface PersonChoiceDto {
  id: string;
  name: string;
  /** False for a person marked do not track. */
  tracked?: boolean;
  /** Their addresses, where the list is used to name a voice. */
  emails?: string[];
}

export interface PersonTrackingInput {
  tracking: 'on' | 'off';
}

export interface PersonDetailDto {
  person: PersonDto;
  /** Vectors in the profile, up to 5 per language. */
  prototypes: number;
  /** One card per language this person has a voice or a verified line in. */
  profiles: LanguageCoverageDto[];
  verified: PersonLineDto[];
  review: PersonLineDto[];
  /** Everyone a line can be moved to. */
  choices: PersonChoiceDto[];
  learning: boolean;
  checking: boolean;
}

export interface PersonInput {
  name: string;
  emails?: string[];
  notes?: string | null;
}

export interface PersonUpdateInput {
  name?: string;
  emails?: string[];
  notes?: string | null;
  /** Fold this person into the one being saved first, in the same transaction. */
  mergeFrom?: string;
}

/** The 409 body when an address already belongs to another person. */
export interface EmailConflictDto {
  email: string;
  /** The person who has the address. */
  personId: string;
  name: string;
  unnamed: boolean;
  source: 'manual' | 'joined' | 'invited';
  /** The person being saved, who would keep their name in a merge. Null when there is none yet. */
  into: { id: string; name: string } | null;
}

export interface PersonMergeInput {
  /** The person that is folded into this one and then removed. */
  sourceId: string;
}

export interface PersonLineMoveInput {
  personId: string;
}

export interface ReviewRosterDto {
  /** Null when the participant is not linked to a person yet. */
  personId: string | null;
  name: string;
}

/** A voice profile that is good enough, so its lines are only asked about when in doubt. */
export interface ReviewCompleteDto extends PersonChoiceDto {
  language: string;
  languageName: string;
}

export interface ReviewConsideredDto {
  name: string;
  /** 0 to 1. */
  score: number;
}

export interface ReviewLineDto {
  id: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  startMs: number;
  endMs: number;
  text: string;
  hasAudio: boolean;
  speakerConfidence: number | null;
  voiceScore: number | null;
  reason: PersonLineReason;
  /** doubt: not sure who this is. training: sure, but the voice profile still needs samples. */
  why: 'doubt' | 'training';
  /** The person the line is labelled as, and who Approve confirms. */
  proposed: PersonChoiceDto;
  /** How well the labelled person scored among the candidates for this line, 0 to 1. */
  proposedScore: number | null;
  /** The language of this line. */
  language: string;
  languageName: string;
  /** Verified seconds already in their voice profile in this language. */
  profileSeconds: number;
  /** The seconds after which the profile is good enough. */
  profileTargetSeconds: number;
  /** Others the system weighed, best first. */
  considered: ReviewConsideredDto[];
  /** The other people of this meeting, without the proposed person and bots. */
  roster: ReviewRosterDto[];
}

export type ReviewOrder = 'newest' | 'uncertain';

export interface ReviewScopeDto {
  person?: PersonChoiceDto;
  meeting?: { id: string; title: string };
}

/** A line to play on a voice card. */
export interface ReviewVoiceLineDto {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  hasAudio: boolean;
}

/**
 * The environment card: the voice labelled as a person in one meeting does not match their
 * profile for most of the meeting. Is it them, or someone else on that account?
 */
export interface ReviewVoiceDto {
  id: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  /** The person the voice is labelled as. */
  person: PersonChoiceDto;
  /** The label in the meeting, such as the name of the account. */
  voiceName: string;
  language: string;
  languageName: string;
  /** The share of the voice's speech that did not match, 0 to 1. */
  mismatch: number;
  /** A few lines to play, the clearest first. */
  lines: ReviewVoiceLineDto[];
  /** Open, or skipped when asked for with the skipped lines. */
  status: 'open' | 'skipped';
}

export interface ReviewQueueDto {
  /** Environment cards, ranked before every line. They count towards the session size. */
  voices: ReviewVoiceDto[];
  /** Newest meeting first by default, or the least sure first. */
  lines: ReviewLineDto[];
  order: ReviewOrder;
  scope: ReviewScopeDto;
  /** Everyone a line can be moved to. */
  people: PersonChoiceDto[];
  /** Useful lines beyond this session's cap, for Keep going. */
  more: number;
  /** People whose profile is good enough, so their lines were left out. */
  complete: ReviewCompleteDto[];
  /** Lines skipped earlier, hidden from this queue until asked for. */
  skippedCount: number;
  learning: boolean;
}
