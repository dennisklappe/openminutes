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
  /** Lines that need a look: uncertain ones and ones the voice check doubts. */
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
}

export type PeopleSort = 'name' | 'meetings' | 'lastSeen';
export type PeopleFilter = 'all' | 'joined' | 'invited';
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
  /** Lines that need a look across everyone, not only this page. */
  needsReview: number;
  page: number;
  pageSize: number;
  /** Voices are learned from lines a person verified. */
  learning: boolean;
  /** Lines are checked against the saved voices. */
  checking: boolean;
}

export type PersonLineReason = 'uncertain' | 'suggested' | 'voice';

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
  hasAudio: boolean;
}

export interface PersonChoiceDto {
  id: string;
  name: string;
  /** False for a person marked do not track. */
  tracked?: boolean;
}

export interface PersonTrackingInput {
  tracking: 'on' | 'off';
}

export interface PersonDetailDto {
  person: PersonDto;
  /** Vectors in the profile, up to 5. */
  prototypes: number;
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
  /** The person the system thinks said it. */
  proposed: PersonChoiceDto;
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

export interface ReviewQueueDto {
  /** Newest meeting first by default, or the least sure first. */
  lines: ReviewLineDto[];
  order: ReviewOrder;
  scope: ReviewScopeDto;
  /** Everyone a line can be moved to. */
  people: PersonChoiceDto[];
  learning: boolean;
}
