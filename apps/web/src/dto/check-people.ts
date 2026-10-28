export interface CheckCompanyDto {
  name: string;
  /** An email domain, or the company of earlier meetings. A hint only, it is never stored. */
  source: 'email' | 'earlier';
}

/** Someone the owner can pick for a voice: an attendee of the calendar event or a known person. */
export interface CheckOptionDto {
  name: string;
  email: string | null;
  personId: string | null;
  source: 'calendar' | 'known';
}

export interface CheckMatchDto {
  name: string;
  /** Set when the name is a person already in People. */
  personId: string | null;
  email: string | null;
  certainty: 'sure' | 'probable';
  /** Where it comes from: the voice profile, the only attendee left, or the name it already has. */
  source: 'voice' | 'calendar' | 'label';
  onCalendar: boolean;
  company: CheckCompanyDto | null;
}

export interface CheckVoiceDto {
  /** The participant of this voice. */
  id: string;
  label: string;
  durationMs: number;
  match: CheckMatchDto | null;
  /** Attendees nobody was matched to, offered for a voice without a match. */
  attendees: CheckOptionDto[];
}

export interface CheckPeopleDto {
  show: boolean;
  count: number;
  voices: CheckVoiceDto[];
  options: CheckOptionDto[];
  rememberEnabled: boolean;
  speakerCount: number | null;
}

export interface CheckPeopleConfirmInput {
  voices: {
    participantId: string;
    /** Someone in People. */
    personId?: string;
    /** A new person, or a name typed in. */
    name?: string;
    email?: string;
  }[];
}
