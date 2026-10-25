import { longFetch } from './long-fetch.js';
import { loadProviderSettings, type SettingsStore } from '@openminutes/core';
import {
  createLocalLanguageDetector,
  createTranscriptionProvider,
  transcriptionProviders,
} from '@openminutes/providers';
import type { TranscriptionProvider } from '@openminutes/providers';

/**
 * The faster-whisper service that ships with OpenMinutes. Its settings are the saved "local"
 * ones, or the defaults while another provider is selected, so speaker detection and the
 * fallback below keep working next to a cloud transcription provider.
 */
export async function localWhisperConfig(
  settings: SettingsStore,
): Promise<{ baseUrl: string; token?: string }> {
  const { configs } = await loadProviderSettings(settings, 'transcription');
  return transcriptionProviders['local']?.configSchema.parse(configs['local'] ?? {}) as {
    baseUrl: string;
    token?: string;
  };
}

/** The local transcriber that redoes a transcript the selected provider got wrong, if another one exists. */
export async function createFallbackTranscriber(
  settings: SettingsStore,
): Promise<TranscriptionProvider | undefined> {
  const { provider, configs } = await loadProviderSettings(settings, 'transcription');
  return provider === 'local'
    ? undefined
    : createTranscriptionProvider('local', configs['local'] ?? {}, { fetch: longFetch });
}

export type DetectLanguage = (path: string) => Promise<string | undefined>;

const OVERRIDE_CONFIDENCE = 0.8;

/**
 * A language fixed in the settings holds, unless the recording itself clearly is in another one
 * (the setting was meant for a different recording): the vote must reach OVERRIDE_CONFIDENCE.
 * Without a setting the vote decides, and without a confident vote the provider detects it.
 */
export function pickLanguage(
  configured: string,
  detected: { language: string; confidence: number } | undefined,
): string | undefined {
  const chosen = configured === 'auto' ? '' : configured;
  if (chosen === '') return detected?.language;
  const clearlyElse =
    detected && detected.language !== chosen && detected.confidence >= OVERRIDE_CONFIDENCE;
  return clearlyElse ? detected.language : chosen;
}

/**
 * The language to transcribe in, from the settings and the majority over several speech-only
 * windows of the recording as heard by the local service. Passing it to every chunk keeps a cloud
 * model from guessing again per chunk.
 */
export function createLanguageDetection(settings: SettingsStore): DetectLanguage {
  return async (path) => {
    const { provider, configs } = await loadProviderSettings(settings, 'transcription');
    const configured = configs[provider]?.['language'];
    const chosen = typeof configured === 'string' ? configured.trim() : '';
    try {
      const { baseUrl, token } = await localWhisperConfig(settings);
      const detector = createLocalLanguageDetector({ baseUrl, token }, { fetch: longFetch });
      return pickLanguage(chosen, await detector.detect({ path }));
    } catch (error) {
      console.error('language detection failed, using the language from the settings', error);
      return pickLanguage(chosen, undefined);
    }
  };
}
