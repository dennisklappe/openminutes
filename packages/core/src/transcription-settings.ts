import {
  createTranscriptionProvider,
  type Deps,
  type TranscriptionProvider,
} from '@openminutes/providers';
import { loadProviderSettings } from './provider-settings.js';
import type { SettingsStore } from './settings.js';

export async function createConfiguredTranscriber(
  settings: SettingsStore,
  deps?: Partial<Deps>,
): Promise<TranscriptionProvider> {
  const { provider, configs } = await loadProviderSettings(settings, 'transcription');
  return createTranscriptionProvider(provider, configs[provider] ?? {}, deps);
}
