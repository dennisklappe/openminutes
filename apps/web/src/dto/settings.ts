export interface SessionDto {
  setupRequired: boolean;
  authenticated: boolean;
  email?: string | undefined;
}

export interface UpdateStatusDto {
  enabled: boolean;
  current: string;
  available: boolean;
  latest?: string;
  url?: string;
}

export interface ProviderFieldDto {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  secret: boolean;
  advanced: boolean;
  default?: string | number | boolean;
  help?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface ProviderDto {
  id: string;
  label: string;
  fields: ProviderFieldDto[];
  values: Record<string, unknown>;
  secretsSet: string[];
}

export interface AiProviderSettingsDto {
  provider: string;
  providers: ProviderDto[];
}

export interface AiProviderSettingsInput {
  provider: string;
  config: Record<string, unknown>;
}

export interface ProviderTestDto {
  ok: boolean;
  detail?: string;
  error?: string;
}

export type CalendarProviderId = 'google' | 'microsoft';

export type JoinRule = 'all' | 'organizer' | 'external' | 'never';

export interface CalendarDto {
  id: string;
  name: string;
  isPrimary: boolean;
  joinRule: JoinRule;
}

export interface CalendarAccountDto {
  id: string;
  provider: CalendarProviderId;
  email: string;
  canExport: boolean;
  canWriteCalendar: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  calendars: CalendarDto[];
}

export interface ProviderSettingsDto {
  redirectUri: string;
  clientId: string | null;
  hasClientSecret: boolean;
  tenant?: string;
}

export interface AccountsDto {
  providers: Record<CalendarProviderId, ProviderSettingsDto>;
  accounts: CalendarAccountDto[];
}

export interface BotSettingsDto {
  name: string;
  joinMessage: string;
  joinMessageEnabled: boolean;
  hasCameraImage: boolean;
  defaults: { name: string; joinMessage: string };
}

export interface GoogleSessionDto {
  status: 'missing' | 'valid' | 'expired';
  expiresAt: string | null;
  credentials: { email: string; hasPassword: boolean; hasTotp: boolean } | null;
  keepAlive: {
    at: string;
    status: 'ok' | 'failed' | 'needs_attention';
    detail?: string | undefined;
  } | null;
  needsAttention: boolean;
  notify: boolean;
}

export interface GoogleCredentialsInput {
  email: string;
  password?: string;
  totpSecret?: string;
}

export interface BotSettingsInput {
  name: string;
  joinMessage: string;
  joinMessageEnabled?: boolean;
}

export type StorageBackend = 'local' | 's3';

export interface S3SettingsDto {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  hasSecretAccessKey: boolean;
}

export interface StorageSettingsDto {
  backend: StorageBackend;
  localPath: string;
  s3: S3SettingsDto;
  retentionDays: number | null;
}

export interface S3SettingsInput {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey?: string;
}

export interface StorageSettingsInput {
  backend: StorageBackend;
  s3: S3SettingsInput;
  retentionDays: number | null;
}

export interface SummaryChatSettingsDto {
  includeChat: boolean;
}

export interface SpeakerSettingsDto {
  refine: boolean;
}

export interface LimitsDto {
  lobbyTimeoutSeconds: number;
  aloneTimeoutSeconds: number;
  maxDurationMinutes: number;
  maxConcurrent: number;
}

export interface TimeZoneDto {
  /** What is saved in Settings, if anything. */
  timeZone: string | null;
  /** What minutes use: the setting, then the TZ variable, then UTC. */
  effective: string;
}

export type WizardStep = 'transcription' | 'summary' | 'calendar' | 'bot' | 'storage' | 'done';

export interface WizardDto {
  completed: boolean;
  step: WizardStep;
}

/** A shared account the owner said holds several people, remembered for the next meeting. */
export interface SharedAccountDto {
  id: string;
  label: string;
  count: number;
  voices: { number: number; personId: string; name: string; unnamed: boolean }[];
}

export interface SharedAccountsDto {
  /** Minutes the summary waits for "how many people?", 0 never waits. */
  waitMinutes: number;
  accounts: SharedAccountDto[];
}

export interface SharedAccountsInput {
  waitMinutes: number;
}

export type ApiKeyScope = 'read' | 'full';

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  scope: ApiKeyScope;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface ApiKeyInput {
  name: string;
  scope: ApiKeyScope;
  expiresInDays: 30 | 90 | 365 | null;
}

/** The secret is in this response only, it cannot be read again. */
export interface ApiKeyCreatedDto {
  key: ApiKeyDto;
  secret: string;
}
