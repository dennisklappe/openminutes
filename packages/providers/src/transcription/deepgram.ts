import { z } from 'zod';
import { audioBlob } from '../audio.js';
import { defineTranscriptionProvider } from '../define.js';
import { joinUrl, request } from '../http.js';
import { endpoint } from '../field-meta.js';
import { languageField } from '../language.js';
import { mimeFor } from '../mime.js';
import { parseJson } from '../parse.js';
import type { Segment } from '../types.js';

const TRANSCRIBE_TIMEOUT_MS = 30 * 60_000;
const TEST_TIMEOUT_MS = 15_000;

const configSchema = z.object({
  apiKey: z.string().min(1).meta({ label: 'API key' }),
  model: z
    .string()
    .min(1)
    .default('nova-3')
    .meta({ label: 'Model', help: 'The Deepgram speech model.' }),
  baseUrl: z.url().default('https://api.deepgram.com').meta(endpoint('Deepgram')),
  language: languageField,
  diarize: z
    .boolean()
    .default(true)
    .meta({ label: 'Identify speakers', help: 'Label who said what from the audio alone.' }),
});

const responseSchema = z.object({
  results: z.object({
    utterances: z
      .array(
        z.object({
          start: z.number(),
          end: z.number(),
          transcript: z.string(),
          confidence: z.number().optional(),
          speaker: z.number().optional(),
          words: z
            .array(
              z.object({
                word: z.string(),
                punctuated_word: z.string().optional(),
                start: z.number(),
                end: z.number(),
              }),
            )
            .optional(),
        }),
      )
      .default([]),
  }),
});

export const deepgram = defineTranscriptionProvider({
  id: 'deepgram',
  label: 'Deepgram',
  configSchema,
  create: (config, deps) => {
    const headers = { Authorization: `Token ${config.apiKey}` };
    return {
      async transcribe(audio, options = {}) {
        const language = options.language ?? config.language;
        const params = new URLSearchParams({
          model: config.model,
          utterances: 'true',
          smart_format: 'true',
          diarize: String(config.diarize),
        });
        if (language) params.set('language', language);
        else params.set('detect_language', 'true');

        const response = await request(
          `${joinUrl(config.baseUrl, '/v1/listen')}?${params.toString()}`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': mimeFor(audio.path) },
            body: await audioBlob(audio.path),
          },
          {
            provider: 'deepgram',
            fetch: deps.fetch,
            timeoutMs: TRANSCRIBE_TIMEOUT_MS,
            signal: options.signal,
          },
        );
        const data = await parseJson('deepgram', response, responseSchema);
        return data.results.utterances
          .filter((u) => u.transcript.trim() !== '')
          .map((u): Segment => ({
            startMs: Math.round(u.start * 1000),
            endMs: Math.round(u.end * 1000),
            text: u.transcript.trim(),
            ...(u.confidence === undefined ? {} : { confidence: u.confidence }),
            ...(u.words?.length
              ? {
                  words: u.words.map((w) => ({
                    startMs: Math.round(w.start * 1000),
                    endMs: Math.round(w.end * 1000),
                    text: w.punctuated_word ?? w.word,
                  })),
                }
              : {}),
            ...(config.diarize && u.speaker !== undefined
              ? { speaker: `Speaker ${String(u.speaker + 1)}` }
              : {}),
          }));
      },
      async test() {
        await request(
          joinUrl(config.baseUrl, '/v1/projects'),
          { headers },
          { provider: 'deepgram', fetch: deps.fetch, timeoutMs: TEST_TIMEOUT_MS },
        );
        return {};
      },
    };
  },
});
