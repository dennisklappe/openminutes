import { ProviderError } from './errors.js';
import { createMedia } from './media.js';
import type { ProviderDefinition } from './define.js';
import { anthropic } from './summary/anthropic.js';
import { none } from './summary/none.js';
import { openaiCompatible } from './summary/openai-compatible.js';
import { assemblyai } from './transcription/assemblyai.js';
import { deepgram } from './transcription/deepgram.js';
import { groq } from './transcription/groq.js';
import { local } from './transcription/local.js';
import { openai } from './transcription/openai.js';
import type { Deps, SummaryProvider, TranscriptionProvider } from './types.js';

export const transcriptionProviders: Record<
  string,
  ProviderDefinition<TranscriptionProvider>
> = Object.fromEntries([openai, groq, deepgram, assemblyai, local].map((p) => [p.id, p]));

export const summaryProviders: Record<
  string,
  ProviderDefinition<SummaryProvider>
> = Object.fromEntries([none, openaiCompatible, anthropic].map((p) => [p.id, p]));

function defaultDeps(overrides: Partial<Deps>): Deps {
  return {
    fetch: (input, init) => fetch(input, init),
    media: createMedia(),
    sleep: (ms, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted', { cause: signal.reason }));
        });
      }),
    ...overrides,
  };
}

function resolve<P>(
  registry: Record<string, ProviderDefinition<P>>,
  kind: string,
  id: string,
  config: unknown,
  deps: Partial<Deps>,
): P {
  const definition = registry[id];
  if (!definition) throw new ProviderError(id, 'invalid_config', `unknown ${kind} provider`);
  return definition.create(config, defaultDeps(deps));
}

export function createTranscriptionProvider(
  id: string,
  config: unknown,
  deps: Partial<Deps> = {},
): TranscriptionProvider {
  return resolve(transcriptionProviders, 'transcription', id, config, deps);
}

export function createSummaryProvider(
  id: string,
  config: unknown,
  deps: Partial<Deps> = {},
): SummaryProvider {
  return resolve(summaryProviders, 'summary', id, config, deps);
}
