import type { CustomTemplate } from '@openminutes/minutes';
import type { CalendarProviderId } from './settings.js';

export interface TemplateOptionDto {
  id: string;
  name: string;
  description: string;
}

export interface CustomChoicesDto {
  fonts: string[];
  logoPlacements: string[];
  dateFormats: string[];
  timeFormats: string[];
  maxTitleLength: number;
  maxExtraLength: number;
}

export interface MinutesSettingsDto {
  template: string;
  custom: CustomTemplate;
  customChoices: CustomChoicesDto;
  includeTranscript: boolean;
  includeChat: boolean;
  linksTab: boolean;
  destinations: DestinationDto[];
  hasLogo: boolean;
  templates: TemplateOptionDto[];
}

export interface DestinationDto {
  id: string;
  label: string;
  enabled: boolean;
  /** False when the account behind it is not connected with export access. */
  available: boolean;
  unavailableReason?: string;
}

export interface MinutesSettingsInput {
  template: string;
  custom?: CustomTemplate;
  includeTranscript: boolean;
  includeChat: boolean;
  linksTab: boolean;
  /** Exporter ids shown as destinations on the meeting page. */
  destinations: string[];
}

export interface MinutesPreviewInput {
  template: string;
  custom: CustomTemplate;
  includeTranscript: boolean;
  includeChat: boolean;
  linksTab: boolean;
}

export interface ExporterDto {
  id: string;
  label: string;
  description: string;
  /** Downloads give a file. Destinations keep a living copy (a doc or a link) that can be updated. */
  kind: 'download' | 'destination';
  /** Destinations only: false when the owner switched it off in Settings, Minutes. */
  enabled: boolean;
}

export type ExportOutcomeDto =
  { kind: 'link'; url: string; label: string; note?: string } | { kind: 'message'; text: string };

/** What an output holds besides the minutes, which are always in. */

export interface MinutesParts {
  includeTranscript: boolean;
  includeChat: boolean;
  includeLinks: boolean;
}

export interface MeetingExportDto extends MinutesParts {
  exporterId: string;
  ref: string;
  url: string;
  updatedAt: string;
}

export interface ExportTargetDto {
  id: string;
  label: string;
  automatic: boolean;
}

export interface ExportSettingsDto {
  target: string | null;
  googleAccountId: string | null;
  microsoftAccountId: string | null;
  ownerEmail: string;
  auto: boolean;
  /** Add the minutes link to the calendar event after each meeting. */
  calendarLink: boolean;
  targets: ExportTargetDto[];
  accounts: {
    id: string;
    provider: CalendarProviderId;
    email: string;
    canExport: boolean;
    canWrite: boolean;
  }[];
}

export interface ExportSettingsInput {
  target: string | null;
  googleAccountId: string | null;
  microsoftAccountId: string | null;
  ownerEmail: string;
  auto: boolean;
  calendarLink: boolean;
}

export interface EmailSettingsDto {
  fromName: string;
  fromAddress: string;
  ownerAddress: string;
  subject: string;
  body: string;
  defaults: { subject: string; body: string };
  placeholders: string[];
  providerReady: boolean;
  sendingDomain: string | null;
  google: { connected: boolean; sendAccounts: string[] };
}

export interface EmailSettingsInput {
  fromName: string;
  fromAddress: string;
  ownerAddress: string;
  subject: string;
  body: string;
}

export interface ShareRecipientDto {
  email: string;
  name: string;
  attended: boolean;
  declined: boolean;
  sentAt: string | null;
}

export interface ShareFormatDto {
  id: string;
  label: string;
  /** The current link when it was shared before, otherwise null. */
  url: string | null;
  updatedAt: string | null;
}

export interface ShareEmailOptionsDto {
  configured: boolean;
  fromAddress: string;
  subject: string;
  body: string;
  placeholders: string[];
  recipients: ShareRecipientDto[];
  /** What "Share as" offers: the enabled destinations that can be shared by link. */
  formats: ShareFormatDto[];
}

/** Without the `include` parts, the shared output follows the defaults of Settings, Minutes. */

export interface ShareEmailInput extends Partial<MinutesParts> {
  recipients: string[];
  extra: string[];
  /** An exporter id from `formats`. Shared by creating it or updating it first. */
  format: string;
  subject: string;
  body: string;
  force: boolean;
}

export interface ShareEmailPreviewDto {
  subject: string;
  html: string;
  text: string;
  willSend: string[];
  alreadySent: string[];
}

export interface ShareEmailResultDto {
  sent: string[];
  skipped: string[];
  failed: { email: string; error: string }[];
  warnings: string[];
}
