import {
  createConfiguredSummarizer,
  SummaryNotConfiguredError,
  type SettingsStore,
} from '@openminutes/core';
import type { Diarizer } from '@openminutes/providers';
import { localWhisperConfig } from './local-whisper.js';
import type { RecordingDeps } from './recording-pipeline.js';

type DiarizerFactory = (config: { baseUrl: string; token?: string }) => Diarizer;

/**
 * Wires the phone recording pipeline to the settings. Speakers are detected by the local whisper
 * service whichever provider transcribes: the audio never goes to a third party for that.
 */
export function createRecordingDeps(
  settings: SettingsStore,
  diarizerFor: DiarizerFactory,
): RecordingDeps {
  return {
    createDiarizer: async () => {
      const { baseUrl, token } = await localWhisperConfig(settings);
      return diarizerFor(token ? { baseUrl, token } : { baseUrl });
    },
    voicesRemembered: async () => (await settings.get('voices.remember')) === 'true',
    createSuggester: async () => {
      try {
        return (await createConfiguredSummarizer(settings)).provider;
      } catch (error) {
        if (error instanceof SummaryNotConfiguredError) return undefined;
        throw error;
      }
    },
  };
}
