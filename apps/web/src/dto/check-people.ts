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

/** A line of a voice to listen to, played from the audio of the meeting between startMs and endMs. */
export interface CheckSampleDto {
  /** The transcript segment. */
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface CheckVoiceDto {
  /** The participant of this voice. */
  id: string;
  label: string;
  durationMs: number;
  match: CheckMatchDto | null;
  /** Attendees nobody was matched to, offered for a voice without a match. */
  attendees: CheckOptionDto[];
  /** Up to 3 clean lines of this voice, in meeting order. */
  samples: CheckSampleDto[];
}

export interface CheckPeopleDto {
  show: boolean;
  count: number;
  voices: CheckVoiceDto[];
  options: CheckOptionDto[];
  rememberEnabled: boolean;
  /** The speakers set on the meeting, else the number of people on the invitation. */
  speakerCount: number | null;
  /** People on the invitation who did not decline, null without an invitation. */
  expectedPeople: number | null;
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
