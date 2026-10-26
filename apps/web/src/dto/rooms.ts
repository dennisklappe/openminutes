import type { VoiceSnippetDto } from './voices.js';
import type { PersonChoiceDto, ReviewRosterDto } from './people.js';

/** A participant tile that probably holds several people, shown quietly on the meeting page. */
export interface RoomNoticeDto {
  participantId: string;
  /** The name of the tile, such as "Meeting room". */
  name: string;
  /** How many voices were found in it. */
  voices: number;
  /** How many of them still have no person. */
  unnamed: number;
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

/** Name a voice with a person from People or a new one, never both. */
export type RoomNameInput = { personId: string } | { newName: string };
