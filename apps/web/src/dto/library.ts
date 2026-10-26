import type {
  MeetingDto,
  MeetingCalendarDto,
  MeetingSeriesDto,
  AudioDto,
  SegmentDto,
  SpeakerChoiceDto,
  SpeakerCheckDto,
} from './meetings.js';
import type { RoomNoticeDto } from './rooms.js';
import type {
  ChatMessageDto,
  SummaryDto,
  SummaryOptionsDto,
  CalendarLinkDto,
  CompanySourceDto,
  MeetingCompanyDto,
} from './summaries.js';

export interface MeetingDetailDto {
  meeting: MeetingDto;
  company: MeetingCompanyDto;
  audio: AudioDto | null;
  audioDeletedAt: string | null;
  scheduledStart: string | null;
  calendars: MeetingCalendarDto[];
  calendarLinks: CalendarLinkDto[];
  calendarLinkEnabled: boolean;
  series: MeetingSeriesDto | null;
  canTranscribe: boolean;
  canSkip: boolean;
  canRejoin: boolean;
  canDelete: boolean;
  segments: SegmentDto[];
  speakerChoices: SpeakerChoiceDto[];
  speakerCheck: SpeakerCheckDto;
  chat: ChatMessageDto[];
  summaries: SummaryDto[];
  /** A person changed who said a line after the active summary was written, and has not dismissed it. */
  speakersChangedSinceSummary: boolean;
  summaryOptions: SummaryOptionsDto;
  /** Participant tiles that probably hold several people and still need naming. */
  roomNotices: RoomNoticeDto[];
}

export interface LibraryMeetingDto {
  id: string;
  title: string;
  platform: MeetingDto['platform'];
  heldAt: string;
  durationMs: number | null;
  people: string[];
  company: string | null;
  companySource: CompanySourceDto | null;
  folderId: string | null;
  snippet: string;
}

export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
}

export interface LibraryDto {
  meetings: LibraryMeetingDto[];
  folders: FolderDto[];
  /** Every company in use, most used first. Used as suggestions. */
  companies: string[];
}

export interface FolderInput {
  name: string;
  parentId?: string | null;
}

export interface CompanyRenameInput {
  from: string;
  to: string;
}
