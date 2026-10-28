import type { VoiceSnippetDto } from './voices.js';
import type { PersonChoiceDto, ReviewRosterDto } from './people.js';

/**
 * The question "Ann and Sam sounds like several people. How many?" for a participant tile
 * that probably holds several people, until it is answered. Quiet card on the meeting page.
 */
export interface RoomNoticeDto {
  participantId: string;
  /** The name of the tile, such as "Meeting room". */
  name: string;
  /** How many voices were found in it. */
  voices: number;
  /** How many of them still have no person. Kept for the naming page. */
  unnamed: number;
  /** When the summary stops waiting for the answer, an ISO date. Null: it does not wait. */
  waitsUntil: string | null;
}

/** The answer to the question: a number of people (1 is "it is one person"), or "not sure". */
export type RoomCountInput = { count: number } | { unsure: true };

/** One person in a shared tile, as listed under the tile in the People card. */
export interface SubPersonDto {
  voiceId: string;
  /** The person (People tab) made for this voice. */
  personId: string;
  /** The seat of that person in this meeting. */
  participantId: string;
  /** 1, 2, ... within the tile, also the colour of the voice in the transcript. */
  number: number;
  name: string;
  /** Still called "Voice N (tile)": nobody gave it a name yet. */
  unnamed: boolean;
  /** What this voice said, not what the seat of the person said otherwise. */
  lines: number;
  talkMs: number;
  /** The same person also is a participant of their own in the meeting, listed on their own row. */
  seatSeparate: boolean;
  /** A few clear lines to listen to. */
  snippets: VoiceSnippetDto[];
  /** The person's own emails, never the tile's unless it was assigned to them. */
  emails: string[];
  /** The invitees of this meeting that are this person. */
  inviteeEmails: string[];
  /** The address typed for them on the meeting. */
  email: string | null;
}

/** What the People card shows under a participant tile that holds several people. */
export interface RoomGroupDto {
  /** The number the owner (or a remembered account) gave. Null: not answered yet. */
  count: number | null;
  /** How many voices were found. */
  detected: number;
  subs: SubPersonDto[];
  /** The meeting has audio, so a sample can be played and a split asked for. */
  hasAudio: boolean;
  /** A split into 2 or 3 can be asked for: no voice has a name yet. */
  canSplit: boolean;
  /** The email address of the tile itself, which can be assigned to one sub-person. */
  tileEmail: string | null;
  /** A split was asked for and is being worked on. */
  splitting: boolean;
}

export interface RoomVoiceDto {
  id: string;
  number: number;
  /** Lines given to this voice. Lines with overlap or too short are not counted. */
  lines: number;
  durationMs: number;
  /** Set once the owner named the voice. */
  personId: string | null;
  personName: string | null;
  /** The person is still the placeholder "Voice N (tile)": nobody named this voice. */
  unnamed: boolean;
  /** A few clear lines of this voice to listen to. */
  snippets: VoiceSnippetDto[];
}

/** Everything the page that names the voices of one tile needs. */
export interface RoomReviewDto {
  meetingId: string;
  meetingTitle: string;
  hasAudio: boolean;
  participant: { id: string; name: string };
  voices: RoomVoiceDto[];
  /** Other people of the meeting, to pick from first. */
  roster: ReviewRosterDto[];
  /** Everyone in People, for "Someone else". */
  people: PersonChoiceDto[];
  /** Voices are learned from the lines that get a name. */
  learning: boolean;
}

/**
 * The addresses chosen while a voice gets its name. They belong to that person only, never to the
 * tile, and one invitee belongs to one person of a tile.
 */
export interface RoomNameEmails {
  /** Invitees of the meeting this person is. */
  inviteeEmails?: string[] | undefined;
  /** An address typed for them. */
  email?: string | null | undefined;
  /** Take the invitees from the person of the same tile who has them. */
  move?: boolean | undefined;
}

/** Name a voice with a person from People or a new one, never both. */
export type RoomNameInput = ({ personId: string } | { newName: string }) & RoomNameEmails;

/** Give a named voice to someone else, or back to nobody (unnamed). */
export type RoomChangeInput = ({ personId: string } | { newName: string } | { unnamed: true }) &
  RoomNameEmails & {
    /** Addresses to take off the previous person. Only ones the preview listed. */
    removeEmails?: string[] | undefined;
  };

/** An address of the previous person that came with this meeting. */
export interface RoomChangeEmailDto {
  email: string;
  /** It is in the person's own addresses. */
  onPerson: boolean;
  /** It is linked to their seat in this meeting (an invitee or a typed address). */
  onSeat: boolean;
  /** The seat exists only for this voice, so the address most likely came with its naming. */
  suggested: boolean;
}

/** What "Change who this is" does to a named voice, for the dialog to say before it is done. */
export interface RoomChangePreviewDto {
  voiceId: string;
  personId: string;
  personName: string;
  /** Lines that move to the new person. */
  lines: number;
  /** Lines a person set by hand, which stay where they are. */
  keptLines: number;
  /** Voice samples of this meeting that leave the profile of the person. */
  samples: number;
  emails: RoomChangeEmailDto[];
}
