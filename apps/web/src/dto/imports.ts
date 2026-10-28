import type { MeetingStatus, ProgressDto } from './meetings.js';

export interface ImportConfigDto {
  /** The largest archive the server takes, in bytes. */
  maxBytes: number;
  /** Size to cut the archive into for upload, in bytes. */
  chunkBytes: number;
}

export interface ImportMeetingDto {
  /** The Fireflies id of the meeting. */
  key: string;
  title: string;
  startedAt: string;
  durationMs: number;
  attendees: number;
  /** Only meetings with a recording can be imported. */
  hasAudio: boolean;
  /** The meeting made from this one, null while it is not imported. */
  meeting: {
    id: string;
    status: MeetingStatus;
    error: string | null;
    progress: ProgressDto | null;
  } | null;
}

export interface ImportPreviewDto {
  id: string;
  meetings: ImportMeetingDto[];
  /** Meetings in the export that could not be read and were left out. */
  unreadable: number;
}

export interface ImportFinishInput {
  chunks: number;
}

export interface ImportStartInput {
  /** Fireflies ids of meetings with a recording. */
  keys: string[];
  /** How many people speak, for the diarization of every chosen meeting. Left out: Auto. */
  speakers?: number | undefined;
}
