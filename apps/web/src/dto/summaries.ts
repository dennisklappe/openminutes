export interface ChatMessageDto {
  id: string;
  sender: string;
  text: string;
  links: string[];
  sentAt: string;
  offsetMs: number;
}

export interface PromptDto {
  id: string;
  name: string;
  content: string;
  builtin: boolean;
}

export interface PromptsDto {
  prompts: PromptDto[];
  defaultId: string;
}

export interface SummaryDto {
  id: string;
  provider: string;
  model: string;
  promptName: string | null;
  status: 'pending' | 'done' | 'failed';
  error: string | null;
  content: string;
  version: number;
  author: string;
  origin: 'ai' | 'ai-edit' | 'edit' | 'link' | 'restore' | 'rename';
  note: string | null;
  restoredFromVersion: number | null;
  active: boolean;
  createdAt: string;
}

export interface SummaryOptionsDto {
  providers: { id: string; label: string }[];
  prompts: { id: string; name: string }[];
  defaultPromptId: string;
  editModel: string | null;
  reapply: { instructions: string[]; manualEdits: boolean };
}

export interface SummaryRequestInput {
  promptId?: string;
  provider?: string;
  reapplyEdits?: boolean;
}

export interface SummaryAiEditInput {
  instruction: string;
  useTranscript: boolean;
  confirmShrink?: boolean;
}

export interface SummaryAiEditDto {
  /** Left out when only the people lists changed and no new version was written. */
  summaryId?: string;
  previousId: string;
  /** What changed in the attendee lists, in plain words. */
  people: string[];
}

export interface CalendarLinkDto {
  accountEmail: string;
  calendarName: string;
  status: 'pending' | 'added' | 'failed' | 'no_permission' | 'needs_reconnect';
  error: string | null;
}

export type CompanySourceDto = 'calendar' | 'ai' | 'manual';

export interface MeetingCompanyDto {
  name: string | null;
  source: CompanySourceDto | null;
  suggestions: string[];
}
