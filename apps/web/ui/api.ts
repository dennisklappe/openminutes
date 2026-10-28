import type { CustomTemplate } from '@openminutes/minutes';
import type {
  AccountsDto,
  ApiKeyCreatedDto,
  ApiKeyDto,
  ApiKeyInput,
  ImportConfigDto,
  ImportPreviewDto,
  ImportStartInput,
  EmailSettingsDto,
  EmailSettingsInput,
  ShareEmailInput,
  ShareEmailOptionsDto,
  ShareEmailPreviewDto,
  ShareEmailResultDto,
  ExporterDto,
  ExportSettingsDto,
  ExportSettingsInput,
  BulkResultDto,
  MeetingExportDto,
  MinutesParts,
  ExportOutcomeDto,
  MinutesSettingsDto,
  MinutesSettingsInput,
  MinutesPreviewInput,
  CalendarProviderId,
  CheckPeopleConfirmInput,
  CheckPeopleDto,
  CompanyRenameInput,
  FolderDto,
  FolderInput,
  JoinRule,
  LibraryDto,
  MeetingDetailDto,
  MeetingDto,
  MeetingListItemDto,
  UpcomingMeetingsDto,
  SkippedSeriesDto,
  PromptsDto,
  AiProviderSettingsDto,
  AiProviderSettingsInput,
  ProviderTestDto,
  SessionDto,
  UpdateStatusDto,
  SummaryAiEditDto,
  SummaryAiEditInput,
  SummaryRequestInput,
  BotSettingsDto,
  BotSettingsInput,
  GoogleCredentialsInput,
  GoogleSessionDto,
  LimitsDto,
  TimeZoneDto,
  ParticipantAliasesDto,
  ParticipantNameInput,
  ParticipantsDto,
  PhoneSettingsDto,
  SpeakerEditInput,
  SpeakerEditResultDto,
  SpeakerSettingsDto,
  SummaryChatSettingsDto,
  StorageSettingsDto,
  StorageSettingsInput,
  PeopleDto,
  PeopleQuery,
  PersonDetailDto,
  ReviewOrder,
  ReviewQueueDto,
  PersonInput,
  SharedAccountsDto,
  SharedAccountsInput,
  PersonUpdateInput,
  RoomCountInput,
  RoomChangeInput,
  RoomChangePreviewDto,
  RoomNameInput,
  RoomReviewDto,
  VoiceNameInput,
  VoicesDto,
  VoiceSettingsDto,
  VoiceTuningDto,
  WizardDto,
} from '../src/dto.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function request<T>(
  path: string,
  init?: { method: string; body?: unknown; file?: Blob; keepalive?: boolean },
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    ...(init?.keepalive && { keepalive: true }),
    ...(init?.body !== undefined && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(init.body),
    }),
    ...(init?.file && { headers: { 'content-type': init.file.type }, body: init.file }),
  });
  const data = (await response.json()) as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? response.statusText, data.code);
  }
  return data;
}

const providerPath = (kind: string) =>
  kind === 'email' ? '/settings/email/provider' : `/settings/${kind}`;

const providerSettings = (kind: 'transcription' | 'summary' | 'email') => ({
  load: () => request<AiProviderSettingsDto>(providerPath(kind)),
  save: (body: AiProviderSettingsInput) =>
    request<AiProviderSettingsDto>(providerPath(kind), { method: 'PUT', body }),
  test: (body: AiProviderSettingsInput) =>
    request<ProviderTestDto>(`${providerPath(kind)}/test`, { method: 'POST', body }),
});

export interface ProviderSettingsClient {
  load: () => Promise<AiProviderSettingsDto>;
  save: (body: AiProviderSettingsInput) => Promise<AiProviderSettingsDto>;
  test: (body: AiProviderSettingsInput) => Promise<ProviderTestDto>;
}

export interface ReprocessOptions {
  language?: string;
  speakers?: number | null;
}

export interface MeetingFilter {
  q?: string;
  platform?: string;
  status?: string;
  upcoming?: 'hide';
  scope?: 'archived' | 'bin';
}

export type BulkAction = 'archive' | 'unarchive' | 'delete' | 'restore' | 'purge';

export interface LibraryFilter {
  q: string;
  platform: string;
  from: string;
  to: string;
}

export interface PromptInput {
  name: string;
  content: string;
}

export const api = {
  session: () => request<SessionDto>('/session'),
  setup: (password: string) => request('/setup', { method: 'POST', body: { password } }),
  login: (password: string) => request('/login', { method: 'POST', body: { password } }),
  logout: () => request('/logout', { method: 'POST' }),
  meetings: (filter: MeetingFilter = {}) => {
    const query = new URLSearchParams(
      Object.entries(filter).filter((entry): entry is [string, string] => entry[1] !== ''),
    ).toString();
    return request<MeetingListItemDto[]>(`/meetings${query && `?${query}`}`);
  },
  upcomingMeetings: (days: number, limit: number) =>
    request<UpcomingMeetingsDto>(`/meetings/upcoming?days=${days}&limit=${limit}`),
  library: (filter: LibraryFilter) => {
    const query = new URLSearchParams(
      Object.entries(filter).filter((entry) => entry[1] !== ''),
    ).toString();
    return request<LibraryDto>(`/library${query && `?${query}`}`);
  },
  createFolder: (body: FolderInput) =>
    request<FolderDto>('/library/folders', { method: 'POST', body }),
  renameFolder: (id: string, name: string) =>
    request<FolderDto>(`/library/folders/${id}`, { method: 'PATCH', body: { name } }),
  deleteFolder: (id: string) => request(`/library/folders/${id}`, { method: 'DELETE' }),
  moveToFolder: (meetingId: string, folderId: string | null) =>
    request(`/library/meetings/${meetingId}/folder`, { method: 'PUT', body: { folderId } }),
  setCompany: (meetingId: string, company: string | null) =>
    request(`/library/meetings/${meetingId}/company`, { method: 'PUT', body: { company } }),
  renameCompany: (body: CompanyRenameInput) =>
    request('/library/companies/rename', { method: 'POST', body }),
  bulkMeetings: (action: BulkAction, ids: string[]) =>
    request<BulkResultDto>('/meetings/bulk', { method: 'POST', body: { action, ids } }),
  skipMeeting: (id: string) => request(`/meetings/${id}/skip`, { method: 'POST' }),
  rejoinMeeting: (id: string) => request(`/meetings/${id}/rejoin`, { method: 'POST' }),
  skipSeries: (id: string) => request(`/meetings/${id}/skip-series`, { method: 'POST' }),
  skippedSeries: () => request<SkippedSeriesDto[]>('/series/skipped'),
  rejoinSeries: (id: string) => request(`/series/skipped/${id}/rejoin`, { method: 'POST' }),
  meeting: (id: string) => request<MeetingDetailDto>(`/meetings/${id}`),
  renameMeeting: (id: string, title: string) =>
    request<MeetingDto>(`/meetings/${id}`, { method: 'PATCH', body: { title } }),
  speakerEdit: (id: string, body: SpeakerEditInput) =>
    request<SpeakerEditResultDto>(`/meetings/${id}/speaker-edits`, { method: 'POST', body }),
  speakerCheck: (id: string) => request(`/meetings/${id}/speaker-check`, { method: 'POST' }),
  checkPeople: (id: string) => request<CheckPeopleDto>(`/meetings/${id}/check-people`),
  confirmCheckPeople: (id: string, body: CheckPeopleConfirmInput) =>
    request<CheckPeopleDto>(`/meetings/${id}/check-people/confirm`, { method: 'POST', body }),
  dismissCheckPeople: (id: string) =>
    request<CheckPeopleDto>(`/meetings/${id}/check-people/dismiss`, { method: 'POST' }),
  voices: (id: string) => request<VoicesDto>(`/meetings/${id}/voices`),
  nameVoice: (id: string, participantId: string, body: VoiceNameInput) =>
    request<VoicesDto>(`/meetings/${id}/voices/${participantId}`, { method: 'PUT', body }),
  participants: (id: string) => request<ParticipantsDto>(`/meetings/${id}/participants`),
  renameParticipant: (id: string, participantId: string, body: ParticipantNameInput) =>
    request<ParticipantsDto>(`/meetings/${id}/participants/${participantId}`, {
      method: 'PUT',
      body,
    }),
  linkInvitee: (id: string, participantId: string, email: string | null, move = false) =>
    request<ParticipantsDto>(`/meetings/${id}/participants/${participantId}/invitee`, {
      method: 'PUT',
      body: move ? { email, move } : { email },
    }),
  /** "They were there" for someone from People, who gets a seat in the meeting. */
  linkInviteeToPerson: (id: string, personId: string, email: string, move = false) =>
    request<ParticipantsDto>(`/meetings/${id}/people/${personId}/invitee`, {
      method: 'PUT',
      body: move ? { email, move } : { email },
    }),
  dismissInvitee: (id: string, email: string) =>
    request<ParticipantsDto>(`/meetings/${id}/dismissed-invitees`, {
      method: 'POST',
      body: { email },
    }),
  participantAliases: () => request<ParticipantAliasesDto>('/settings/participant-aliases'),
  saveParticipantAlias: (id: string, displayName: string) =>
    request<ParticipantAliasesDto>(`/settings/participant-aliases/${id}`, {
      method: 'PUT',
      body: { displayName },
    }),
  deleteParticipantAlias: (id: string) =>
    request<ParticipantAliasesDto>(`/settings/participant-aliases/${id}`, { method: 'DELETE' }),
  voiceSettings: () => request<VoiceSettingsDto>('/settings/voices'),
  saveVoiceSettings: (body: Partial<{ remember: boolean; check: boolean } & VoiceTuningDto>) =>
    request<VoiceSettingsDto>('/settings/voices', { method: 'PUT', body }),
  people: (query: PeopleQuery = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const text = params.toString();
    return request<PeopleDto>(text ? `/people?${text}` : '/people');
  },
  scanPeople: () =>
    request<{ createdJoined: number; createdInvited: number }>('/people/backfill', {
      method: 'POST',
    }),
  person: (id: string) => request<PersonDetailDto>(`/people/${id}`),
  reviewQueue: (
    scope: {
      personId?: string;
      meetingId?: string;
      order?: ReviewOrder;
      skipped?: boolean;
    } = {},
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(scope)) {
      if (value) params.set(key, value === true ? '1' : value);
    }
    const text = params.toString();
    return request<ReviewQueueDto>(text ? `/people/review?${text}` : '/people/review');
  },
  setTracking: (id: string, tracking: 'on' | 'off') =>
    request<PersonDetailDto>(`/people/${id}/tracking`, { method: 'POST', body: { tracking } }),
  createPerson: (body: PersonInput) =>
    request<PersonDetailDto>('/people', { method: 'POST', body }),
  updatePerson: (id: string, body: PersonUpdateInput) =>
    request<PersonDetailDto>(`/people/${id}`, { method: 'PATCH', body }),
  mergePerson: (id: string, sourceId: string) =>
    request<PersonDetailDto>(`/people/${id}/merge`, { method: 'POST', body: { sourceId } }),
  deletePerson: (id: string) => request<PeopleDto>(`/people/${id}`, { method: 'DELETE' }),
  forgetPersonVoice: (id: string) =>
    request<PersonDetailDto>(`/people/${id}/voice`, { method: 'DELETE' }),
  verifyLine: (id: string, segmentId: string) =>
    request<PersonDetailDto>(`/people/${id}/lines/${segmentId}/verify`, {
      method: 'POST',
      body: {},
      keepalive: true,
    }),
  rejectLine: (id: string, segmentId: string) =>
    request<PersonDetailDto>(`/people/${id}/lines/${segmentId}/reject`, {
      method: 'POST',
      body: {},
      keepalive: true,
    }),
  moveLine: (id: string, segmentId: string, personId: string) =>
    request<PersonDetailDto>(`/people/${id}/lines/${segmentId}/move`, {
      method: 'POST',
      body: { personId },
      keepalive: true,
    }),
  splitLine: (id: string, segmentId: string, body: { cuts: number[]; personIds: string[] }) =>
    request<PersonDetailDto>(`/people/${id}/lines/${segmentId}/split`, {
      method: 'POST',
      body,
      keepalive: true,
    }),
  markMixed: (id: string, segmentId: string) =>
    request<PersonDetailDto>(`/people/${id}/lines/${segmentId}/mixed`, {
      method: 'POST',
      body: {},
      keepalive: true,
    }),
  skipLine: (personId: string, segmentId: string) =>
    request<{ ok: true }>('/people/review/skip', {
      method: 'POST',
      body: { personId, segmentId },
      keepalive: true,
    }),
  confirmVoice: (id: string) =>
    request<{ ok: true }>(`/people/review/voices/${id}/confirm`, {
      method: 'POST',
      body: {},
      keepalive: true,
    }),
  moveVoice: (id: string, personId: string) =>
    request<{ ok: true }>(`/people/review/voices/${id}/move`, {
      method: 'POST',
      body: { personId },
      keepalive: true,
    }),
  skipVoice: (id: string) =>
    request<{ ok: true }>(`/people/review/voices/${id}/skip`, {
      method: 'POST',
      body: {},
      keepalive: true,
    }),
  reopenVoice: (id: string) =>
    request<{ ok: true }>(`/people/review/voices/${id}/reopen`, { method: 'POST', body: {} }),
  undoReviewDecision: (segmentId: string) =>
    request<{ undone: string | null }>('/people/review/undo', {
      method: 'POST',
      body: { segmentId },
    }),
  removeLineFromProfile: (id: string, segmentId: string) =>
    request<PersonDetailDto>(`/people/${id}/lines/${segmentId}/profile`, { method: 'DELETE' }),
  removeAutoSamples: (id: string, language: string) =>
    request<PersonDetailDto>(`/people/${id}/voice/${language}/auto`, { method: 'DELETE' }),
  removeMeetingAutoSamples: (meetingId: string) =>
    request<{ removed: number }>(`/people/auto-voices/${meetingId}`, { method: 'DELETE' }),
  forgetPersonProfile: (id: string, language: string) =>
    request<PersonDetailDto>(`/people/${id}/voice/${language}`, { method: 'DELETE' }),
  forgetVoice: (id: string) =>
    request<VoiceSettingsDto>(`/settings/voices/${id}`, { method: 'DELETE' }),
  forgetAllVoices: () => request<VoiceSettingsDto>('/settings/voices', { method: 'DELETE' }),
  rerunSpeakers: (id: string, speakers: number) =>
    request(`/meetings/${id}/rerun-speakers`, { method: 'POST', body: { speakers } }),
  rerunVoices: (id: string) => request(`/meetings/${id}/rerun-voices`, { method: 'POST' }),
  cancelProcessing: (id: string) => request(`/meetings/${id}/cancel`, { method: 'POST' }),
  reprocess: (id: string, options: ReprocessOptions = {}) =>
    request(`/meetings/${id}/reprocess`, { method: 'POST', body: options }),
  accounts: () => request<AccountsDto>('/accounts'),
  saveProvider: (
    provider: CalendarProviderId,
    body: { clientId: string; clientSecret?: string; tenant?: string },
  ) => request(`/accounts/providers/${provider}`, { method: 'PUT', body }),
  disconnect: (accountId: string) => request(`/accounts/${accountId}`, { method: 'DELETE' }),
  syncAccount: (accountId: string) => request(`/accounts/${accountId}/sync`, { method: 'POST' }),
  setJoinRule: (calendarId: string, joinRule: JoinRule) =>
    request(`/accounts/calendars/${calendarId}`, { method: 'PUT', body: { joinRule } }),
  transcriptionSettings: providerSettings('transcription'),
  summarySettings: providerSettings('summary'),
  emailProviderSettings: providerSettings('email'),
  emailSettings: () => request<EmailSettingsDto>('/settings/email'),
  saveEmailSettings: (body: EmailSettingsInput) =>
    request<EmailSettingsDto>('/settings/email', { method: 'PUT', body }),
  sendTestEmail: () => request<ProviderTestDto>('/settings/email/send-test', { method: 'POST' }),
  shareEmailOptions: (id: string) => request<ShareEmailOptionsDto>(`/meetings/${id}/share-email`),
  previewShareEmail: (id: string, body: ShareEmailInput) =>
    request<ShareEmailPreviewDto>(`/meetings/${id}/share-email/preview`, { method: 'POST', body }),
  sendShareEmail: (id: string, body: ShareEmailInput) =>
    request<ShareEmailResultDto>(`/meetings/${id}/share-email`, { method: 'POST', body }),
  roomReview: (id: string, participantId: string) =>
    request<RoomReviewDto>(`/meetings/${id}/room/${participantId}`),
  roomChangePreview: (id: string, voiceId: string) =>
    request<RoomChangePreviewDto>(`/meetings/${id}/room-voices/${voiceId}/change`),
  /** Gives a named voice to someone else, or back to unnamed. */
  changeRoomVoice: (id: string, voiceId: string, body: RoomChangeInput) =>
    request(`/meetings/${id}/room-voices/${voiceId}/change`, { method: 'POST', body }),
  nameRoomVoice: (id: string, voiceId: string, body: RoomNameInput) =>
    request(`/meetings/${id}/room-voices/${voiceId}/name`, { method: 'POST', body }),
  /** Answers "how many people?", or asks for a split with a fixed count. */
  roomCount: (id: string, participantId: string, body: RoomCountInput) =>
    request<{ ok: true; splitting: boolean }>(`/meetings/${id}/room/${participantId}/count`, {
      method: 'POST',
      body,
    }),
  /** Names an unnamed person of a shared account, or folds it into an existing person. */
  nameVoicePerson: (personId: string, body: { name: string } | { personId: string }) =>
    request<{ ok: true; personId: string }>(`/people/${personId}/name-voice`, {
      method: 'POST',
      body,
    }),
  apiKeys: () => request<ApiKeyDto[]>('/settings/api-keys'),
  createApiKey: (body: ApiKeyInput) =>
    request<ApiKeyCreatedDto>('/settings/api-keys', { method: 'POST', body }),
  revokeApiKey: (id: string) => request(`/settings/api-keys/${id}`, { method: 'DELETE' }),
  sharedAccounts: () => request<SharedAccountsDto>('/settings/shared-accounts'),
  saveSharedAccounts: (body: SharedAccountsInput) =>
    request<SharedAccountsDto>('/settings/shared-accounts', { method: 'PUT', body }),
  removeSharedAccount: (id: string) =>
    request<SharedAccountsDto>(`/settings/shared-accounts/${id}`, { method: 'DELETE' }),
  dismissRoom: (id: string, participantId: string) =>
    request(`/meetings/${id}/room/${participantId}/dismiss`, { method: 'POST' }),
  dismissSpeakersNotice: (id: string) =>
    request(`/meetings/${id}/speakers-notice/dismiss`, { method: 'POST' }),
  summarize: (id: string, body: SummaryRequestInput) =>
    request(`/meetings/${id}/summaries`, { method: 'POST', body }),
  prompts: () => request<PromptsDto>('/settings/prompts'),
  createPrompt: (body: PromptInput) =>
    request<PromptsDto>('/settings/prompts', { method: 'POST', body }),
  updatePrompt: (id: string, body: PromptInput) =>
    request<PromptsDto>(`/settings/prompts/${id}`, { method: 'PUT', body }),
  deletePrompt: (id: string) =>
    request<PromptsDto>(`/settings/prompts/${id}`, { method: 'DELETE' }),
  makeDefaultPrompt: (id: string) =>
    request<PromptsDto>(`/settings/prompts/${id}/default`, { method: 'POST' }),
  botSettings: () => request<BotSettingsDto>('/settings/bot'),
  saveBotSettings: (body: BotSettingsInput) =>
    request<BotSettingsDto>('/settings/bot', { method: 'PUT', body }),
  uploadBotCamera: (file: File) =>
    request<BotSettingsDto>('/settings/bot/camera', { method: 'PUT', file }),
  removeBotCamera: () => request<BotSettingsDto>('/settings/bot/camera', { method: 'DELETE' }),
  googleSession: () => request<GoogleSessionDto>('/settings/bot/google-session'),
  importGoogleSession: async (file: File) =>
    request<GoogleSessionDto>('/settings/bot/google-session', {
      method: 'PUT',
      body: JSON.parse(await file.text()) as unknown,
    }),
  removeGoogleSession: () =>
    request<GoogleSessionDto>('/settings/bot/google-session', { method: 'DELETE' }),
  saveGoogleCredentials: (body: GoogleCredentialsInput) =>
    request<GoogleSessionDto>('/settings/bot/google-credentials', { method: 'PUT', body }),
  removeGoogleCredentials: () =>
    request<GoogleSessionDto>('/settings/bot/google-credentials', { method: 'DELETE' }),
  setGoogleNotifications: (notify: boolean) =>
    request<GoogleSessionDto>('/settings/bot/google-notifications', {
      method: 'PUT',
      body: { notify },
    }),
  storageSettings: () => request<StorageSettingsDto>('/settings/storage'),
  saveStorageSettings: (body: StorageSettingsInput) =>
    request<StorageSettingsDto>('/settings/storage', { method: 'PUT', body }),
  testStorage: (body: StorageSettingsInput) =>
    request<ProviderTestDto>('/settings/storage/test', { method: 'POST', body }),
  speakerSettings: () => request<SpeakerSettingsDto>('/settings/speakers'),
  saveSpeakerSettings: (body: SpeakerSettingsDto) =>
    request<SpeakerSettingsDto>('/settings/speakers', { method: 'PUT', body }),
  importConfig: () => request<ImportConfigDto>('/imports/config'),
  importChunk: (id: string, index: number, file: Blob) =>
    request<{ ok: true }>(`/imports/${id}/chunks/${String(index)}`, { method: 'PUT', file }),
  importFinish: (id: string, chunks: number) =>
    request<ImportPreviewDto>(`/imports/${id}/finish`, { method: 'POST', body: { chunks } }),
  importPreview: (id: string) => request<ImportPreviewDto>(`/imports/${id}`),
  importStart: (id: string, body: ImportStartInput) =>
    request<ImportPreviewDto>(`/imports/${id}/start`, { method: 'POST', body }),
  importDiscard: (id: string) => request<{ ok: true }>(`/imports/${id}`, { method: 'DELETE' }),
  phoneSettings: () => request<PhoneSettingsDto>('/settings/phone'),
  savePhoneSettings: (body: { enabled: boolean; consentText: string }) =>
    request<PhoneSettingsDto>('/settings/phone', { method: 'PUT', body }),
  summaryChatSettings: () => request<SummaryChatSettingsDto>('/settings/summary-chat'),
  saveSummaryChatSettings: (body: SummaryChatSettingsDto) =>
    request<SummaryChatSettingsDto>('/settings/summary-chat', { method: 'PUT', body }),
  limits: () => request<LimitsDto>('/settings/limits'),
  saveLimits: (body: LimitsDto) => request<LimitsDto>('/settings/limits', { method: 'PUT', body }),
  timeZone: () => request<TimeZoneDto>('/settings/timezone'),
  saveTimeZone: (body: { timeZone: string; onlyIfUnset?: boolean }) =>
    request<TimeZoneDto>('/settings/timezone', { method: 'PUT', body }),
  wizard: () => request<WizardDto>('/settings/wizard'),
  saveWizard: (body: Partial<WizardDto>) =>
    request<WizardDto>('/settings/wizard', { method: 'PUT', body }),
  minutesSettings: () => request<MinutesSettingsDto>('/settings/minutes'),
  saveMinutesSettings: (body: MinutesSettingsInput) =>
    request<MinutesSettingsDto>('/settings/minutes', { method: 'PUT', body }),
  previewMinutes: (body: MinutesPreviewInput) =>
    request<{ html: string }>('/settings/minutes/preview', { method: 'POST', body }),
  checkCustomTemplate: (body: unknown) =>
    request<CustomTemplate>('/settings/minutes/custom/check', { method: 'POST', body }),
  uploadMinutesLogo: (file: File) =>
    request<MinutesSettingsDto>('/settings/minutes/logo', { method: 'PUT', file }),
  removeMinutesLogo: () =>
    request<MinutesSettingsDto>('/settings/minutes/logo', { method: 'DELETE' }),
  editSummary: (id: string, content: string) =>
    request(`/meetings/${id}/summaries/edit`, { method: 'POST', body: { content } }),
  aiEditSummary: (id: string, body: SummaryAiEditInput) =>
    request<SummaryAiEditDto>(`/meetings/${id}/summary/ai-edit`, { method: 'POST', body }),
  restoreSummary: (id: string, summaryId: string) =>
    request(`/meetings/${id}/summaries/${summaryId}/restore`, { method: 'POST' }),
  updateShareLink: (id: string, shareId: string, parts: MinutesParts) =>
    request<MinutesParts>(`/meetings/${id}/shares/${shareId}`, { method: 'PATCH', body: parts }),
  revokeShareLink: (id: string, shareId: string) =>
    request(`/meetings/${id}/shares/${shareId}`, { method: 'DELETE' }),
  exporters: () => request<ExporterDto[]>('/exporters'),
  meetingExports: (id: string) => request<MeetingExportDto[]>(`/meetings/${id}/exports`),
  addCalendarLink: (id: string) => request(`/meetings/${id}/calendar-link`, { method: 'POST' }),
  exportSettings: () => request<ExportSettingsDto>('/settings/minutes/export'),
  saveExportSettings: (body: ExportSettingsInput) =>
    request<ExportSettingsDto>('/settings/minutes/export', { method: 'PUT', body }),
  version: () => request<{ version: string }>('/version'),
  updates: () => request<UpdateStatusDto>('/settings/updates'),
  setUpdateNotices: (enabled: boolean) =>
    request<UpdateStatusDto>('/settings/updates', { method: 'PUT', body: { enabled } }),
  dismissUpdate: (version: string) =>
    request<UpdateStatusDto>('/settings/updates/dismiss', { method: 'POST', body: { version } }),
  join: (url: string, force = false) =>
    request<MeetingDto>('/meetings', { method: 'POST', body: { url, force } }),
};

export const meetingUrl = (meetingId: string, path: string) => `/api/meetings/${meetingId}/${path}`;

export type ExportResult = { kind: 'file'; filename: string } | ExportOutcomeDto;

export async function exportMinutes(
  meetingId: string,
  exporterId: string,
  parts?: MinutesParts,
  mode?: 'update' | 'new',
): Promise<ExportResult> {
  const response = await fetch(`/api/meetings/${meetingId}/export/${exporterId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...parts,
      ...(mode && { mode }),
    }),
  });
  if (!response.ok) {
    const failure = (await response.json()) as { error?: string };
    throw new ApiError(response.status, failure.error ?? response.statusText);
  }
  const disposition = response.headers.get('content-disposition');
  if (!disposition) return (await response.json()) as ExportOutcomeDto;
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'minutes';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(await response.blob());
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  return { kind: 'file', filename };
}
