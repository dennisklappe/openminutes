export type MeetingStatus =
  | 'scheduled'
  | 'uploading'
  | 'joining'
  | 'in_lobby'
  | 'recording'
  | 'ended'
  | 'processing'
  | 'transcribed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export interface ProgressDto {
  step: string | null;
  current: number | null;
  total: number | null;
  startedAt: string | null;
}

export interface MeetingDto {
  id: string;
  title: string;
  platform: 'meet' | 'teams' | 'recording' | 'imported';
  joinUrl: string;
  status: MeetingStatus;
  error: string | null;
  speakersRefined: boolean;
  language: string | null;
  speakerCount: number | null;
  progress: ProgressDto | null;
  titleEdited: boolean;
  startedAt: string | null;
  endedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  /** When the bin removes a deleted meeting for good. */
  purgeAt: string | null;
  createdAt: string;
}

export interface MeetingCalendarDto {
  name: string;
  accountEmail: string;
}

export interface SkippedSeriesDto {
  id: string;
  title: string;
  since: string;
}

export interface MeetingSeriesDto {
  skippedId: string | null;
}

export interface MeetingListItemDto extends MeetingDto {
  series: MeetingSeriesDto | null;
  scheduledStart: string | null;
  durationMs: number | null;
  participantCount: number;
  /** Over, so it can be archived or deleted. */
  canDelete: boolean;
}

export interface BulkResultDto {
  changed: number;
  skipped: number;
}

export interface UpcomingMeetingsDto {
  items: MeetingListItemDto[];
  total: number;
  all: number;
}

export interface AudioDto {
  durationMs: number;
  size: number;
}

export type SpeakerSourceDto = 'indicator' | 'diarization' | 'user' | 'ai' | 'guess';

export interface SegmentDto {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker: string | null;
  speakerId: string | null;
  speakerConfidence: number | null;
  speakerSource: SpeakerSourceDto | null;
  uncertain: boolean;
  previousSpeaker: string | null;
  /** Who the speaker review thinks said it, for the person to accept or turn down. */
  suggestedSpeaker: string | null;
  suggestedSpeakerId: string | null;
}

export interface SpeakerChoiceDto {
  id: string;
  name: string;
}

export interface SpeakerCheckDto {
  ai: boolean;
  running: boolean;
  checkedAt: string | null;
  error: string | null;
}

export interface SpeakerSnapshotDto {
  id: string;
  speakerId: string | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  speakerConfidence: number | null;
  speakerSource: SpeakerSourceDto | null;
  speakerCandidates: { participantId: string; score: number }[] | null;
  previousSpeakerId: string | null;
  suggestedSpeakerId: string | null;
  rejectedSuggestions: string[];
}

export type SpeakerTargetInput = { id: string } | { name: string } | { create: true };

export type SpeakerEditInput =
  | { kind: 'assign'; segmentIds: string[]; speaker: SpeakerTargetInput }
  | {
      kind: 'split';
      segmentId: string;
      wordIndex: number;
      speaker?: SpeakerTargetInput | undefined;
    }
  | { kind: 'merge'; segmentIds: string[] }
  | { kind: 'revert'; segmentIds: string[] }
  | { kind: 'reject-suggestion'; segmentIds: string[] }
  | {
      kind: 'restore';
      rows: SpeakerSnapshotDto[];
      removeIds: string[];
      removeSpeakerIds: string[];
    };

export interface SpeakerEditResultDto {
  segments: SegmentDto[];
  speakerChoices: SpeakerChoiceDto[];
  undo: SpeakerEditInput;
}

export interface MeetingTitleInput {
  title: string;
}
