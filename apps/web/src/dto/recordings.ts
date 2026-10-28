import type { MeetingStatus } from './meetings.js';

export interface PhoneConfigDto {
  enabled: boolean;
  consentText: string;
}

export interface PhoneSettingsDto extends PhoneConfigDto {
  defaults: { consentText: string };
}

export interface RecordingStartInput {
  id: string;
  mimeType: string;
  startedAt: string;
  speakers?: number | undefined;
  /** A calendar meeting to link the recording to. A link that no longer fits is left out. */
  eventId?: string | undefined;
}

export interface RecordingStatusDto {
  id: string;
  status: MeetingStatus;
  received: number[];
  maxChunkBytes: number;
}

export interface RecordingFinishInput {
  chunks: number;
  durationMs: number;
}
