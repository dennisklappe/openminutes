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
  meetings: number;
}

export interface PeopleDto {
  people: PersonDto[];
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
