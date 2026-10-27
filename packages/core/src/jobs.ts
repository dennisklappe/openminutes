export interface MeetingJobPayload {
  meetingId: string;
}

export interface ProcessJobPayload extends MeetingJobPayload {
  language?: string;
}

export interface ImportJobPayload extends MeetingJobPayload {
  uploadId: string;
  firefliesId: string;
}

export interface JoinJobPayload extends MeetingJobPayload {
  scheduledStart: string | null;
}

export interface CalendarSyncPayload {
  accountId?: string;
}

export interface CalendarLinkPayload extends MeetingJobPayload {
  force?: boolean;
}

export interface LearnVoiceJobPayload extends MeetingJobPayload {
  participantId: string;
  segmentIds: string[];
}

export interface SplitRoomJobPayload extends MeetingJobPayload {
  participantId: string;
  /** How many people sit in the tile, 2 to 4. */
  count: number;
}

export interface SummaryJobPayload {
  summaryId: string;
}

export type RetentionPayload = Record<string, never>;

export interface SessionAlertPayload {
  reason: string;
}

export interface JobPayloads {
  'meeting.schedule': MeetingJobPayload;
  'meeting.join': JoinJobPayload;
  'meeting.process': ProcessJobPayload;
  'meeting.import': ImportJobPayload;
  'meeting.review-speakers': MeetingJobPayload;
  'meeting.learn-voice': LearnVoiceJobPayload;
  'meeting.split-room': SplitRoomJobPayload;
  'calendar.sync': CalendarSyncPayload;
  'meeting.summarize': SummaryJobPayload;
  'meeting.export': MeetingJobPayload;
  'meeting.calendar-link': CalendarLinkPayload;
  'audio.retention': RetentionPayload;
  'bin.purge': RetentionPayload;
  'meeting.watchdog': RetentionPayload;
  'bot.google-keepalive': RetentionPayload;
  'bot.session-alert': SessionAlertPayload;
}

export type JobName = keyof JobPayloads;

export const jobNames: readonly JobName[] = [
  'meeting.schedule',
  'meeting.join',
  'meeting.process',
  'meeting.import',
  'meeting.review-speakers',
  'meeting.learn-voice',
  'meeting.split-room',
  'calendar.sync',
  'meeting.summarize',
  'meeting.export',
  'meeting.calendar-link',
  'audio.retention',
  'bin.purge',
  'meeting.watchdog',
  'bot.google-keepalive',
  'bot.session-alert',
];

export const CALENDAR_LINK_RETRY = { retryLimit: 5, retryDelay: 60, retryBackoff: true };
