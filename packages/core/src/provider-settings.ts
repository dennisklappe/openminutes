import { z } from 'zod';
import type { SettingsStore } from './settings.js';

export type ProviderKind = 'transcription' | 'summary' | 'email';
export type ProviderConfigs = Record<string, Record<string, unknown>>;

const defaultProvider: Record<ProviderKind, string> = {
  transcription: 'local',
  summary: 'none',
  email: 'smtp',
};

const configsSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

export async function loadProviderSettings(
  settings: SettingsStore,
  kind: ProviderKind,
): Promise<{ provider: string; configs: ProviderConfigs }> {
  const [provider, configs] = await Promise.all([
    settings.get(`${kind}.provider`),
    settings.get(`${kind}.configs`),
  ]);
  return {
    provider: provider ?? defaultProvider[kind],
    configs: configsSchema.parse(JSON.parse(configs ?? '{}')),
  };
}

export async function saveProviderSettings(
  settings: SettingsStore,
  kind: ProviderKind,
  provider: string,
  config: Record<string, unknown>,
): Promise<void> {
  const current = await loadProviderSettings(settings, kind);
  await settings.set(`${kind}.configs`, JSON.stringify({ ...current.configs, [provider]: config }));
  await settings.set(`${kind}.provider`, provider);
}
