import type { SettingsStore } from '@openminutes/core';

export interface ExportConfig {
  target: string | undefined;
  googleAccountId: string | undefined;
  microsoftAccountId: string | undefined;
  ownerEmail: string | undefined;
  auto: boolean;
}

const KEYS = {
  target: 'export.target',
  googleAccountId: 'export.google_account',
  microsoftAccountId: 'export.microsoft_account',
  ownerEmail: 'export.owner_email',
  auto: 'export.auto',
} as const;

export async function loadExportConfig(settings: SettingsStore): Promise<ExportConfig> {
  const [target, googleAccountId, microsoftAccountId, ownerEmail, auto] = await Promise.all(
    Object.values(KEYS).map((key) => settings.get(key)),
  );
  return {
    target: target || undefined,
    googleAccountId: googleAccountId || undefined,
    microsoftAccountId: microsoftAccountId || undefined,
    ownerEmail: ownerEmail || undefined,
    auto: auto === 'true',
  };
}

export async function saveExportConfig(
  settings: SettingsStore,
  config: ExportConfig,
): Promise<void> {
  const values: Record<keyof ExportConfig, string | undefined> = {
    target: config.target,
    googleAccountId: config.googleAccountId,
    microsoftAccountId: config.microsoftAccountId,
    ownerEmail: config.ownerEmail,
    auto: String(config.auto),
  };
  for (const [name, key] of Object.entries(KEYS)) {
    const value = values[name as keyof ExportConfig];
    if (value) await settings.set(key, value);
    else await settings.delete(key);
  }
}
