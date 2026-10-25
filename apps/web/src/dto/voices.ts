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
}

export interface ParticipantDto {
  id: string;
  name: string;
  originalName: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  talkMs: number;
  confirmed: boolean;
  inviteeEmail: string | null;
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
  /** The invitee this person is: an email, null to unlink, left out to keep the link. */
  inviteeEmail?: string | null;
}

export interface InviteeLinkInput {
  email: string | null;
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
  remember: boolean;
  known: KnownVoiceDto[];
}
