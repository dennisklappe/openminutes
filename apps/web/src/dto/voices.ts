import type { RoomGroupDto } from './rooms.js';

export interface VoiceSnippetDto {
  startMs: number;
  endMs: number;
  text: string;
}

export interface VoiceSuggestionDto {
  name: string;
  source: 'conversation' | 'voice' | 'calendar' | 'participant';
}

export interface VoiceDto {
  id: string;
  name: string;
  confirmed: boolean;
  durationMs: number;
  snippets: VoiceSnippetDto[];
  suggestions: VoiceSuggestionDto[];
}

export interface VoicesDto {
  voices: VoiceDto[];
  needsNaming: boolean;
  rememberEnabled: boolean;
}

export interface VoiceNameInput {
  name: string;
  remember?: boolean;
  /** Take the addresses from the person of the same shared account who has them. */
  move?: boolean;
}

export interface ParticipantDto {
  /** Set when several people share this participant: the people under it. */
  room?: RoomGroupDto;
  /** A person can say this participant is several people and split it, there is audio to listen to. */
  canSplit?: boolean;
  id: string;
  name: string;
  originalName: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  talkMs: number;
  confirmed: boolean;
  /** The address of someone who is not on the invitation, typed by the owner. */
  email: string | null;
  /** Every invitee this person is. */
  inviteeEmails: string[];
}

export interface InviteeDto {
  email: string;
  name: string | null;
  declined: boolean;
}

export interface ParticipantsDto {
  participants: ParticipantDto[];
  /** Every calendar invitee of the meeting. */
  invitees: InviteeDto[];
  /** Invitees nobody was matched to and nobody removed from the list. */
  absent: InviteeDto[];
  summaryUpdated: boolean;
}

export interface ParticipantNameInput {
  name: string;
  remember?: boolean;
  /** Every invitee this person is, [] to unlink, left out to keep the links. */
  inviteeEmails?: string[];
  /** An address for someone who is not on the invitation, null to clear, left out to keep it. */
  email?: string | null;
}

export interface InviteeLinkInput {
  /** Added to the invitees the person is, null removes all links. */
  email: string | null;
  /** Take it from the person of the same shared account who has it. */
  move?: boolean;
}

export interface DismissInviteeInput {
  email: string;
}

export interface ParticipantAliasDto {
  id: string;
  originalName: string;
  displayName: string;
}

export interface ParticipantAliasesDto {
  aliases: ParticipantAliasDto[];
}

export interface KnownVoiceDto {
  id: string;
  name: string;
  samples: number;
  updatedAt: string;
}

export interface VoiceSettingsDto {
  /** Learn voices from lines a person verified. */
  remember: boolean;
  /** Check lines against the saved voices. */
  check: boolean;
  known: KnownVoiceDto[];
  /** The numbers behind readiness, agreement and ways of sounding. */
  tuning: VoiceTuningDto;
  /** The defaults of `tuning`, for a Reset. */
  tuningDefaults: VoiceTuningDto;
}

export interface VoiceTuningDto {
  /** Seconds of clean speech that fill the Length bar. */
  readySeconds: number;
  /** Meetings that fill the Variety bar. */
  readyMeetings: number;
  /** Ways of sounding that fill the Variety bar. */
  readyWays: number;
  /** A line scoring at least this against a profile sounds like the person. */
  agreeScore: number;
  /** A sample joins the closest way of sounding at this similarity or more. */
  mergeSimilarity: number;
}
