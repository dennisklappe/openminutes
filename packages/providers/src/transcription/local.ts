import { z } from 'zod';
import { audioForm } from '../audio.js';
import { defineTranscriptionProvider } from '../define.js';
import { languageField } from '../language.js';
import { joinUrl, request } from '../http.js';
import { parseJson } from '../parse.js';
import type { Segment } from '../types.js';

const TRANSCRIBE_TIMEOUT_MS = 6 * 60 * 60_000;
const TEST_TIMEOUT_MS = 15_000;

const configSchema = z.object({
  baseUrl: z.url().default('http://whisper:8000').meta({
    label: 'Service URL',
    help: 'Where the faster-whisper service runs. The bundled one is http://whisper:8000.',
  }),
  token: z
    .string()
    .optional()
    .meta({ label: 'Access token', help: 'Only needed when the service asks for one.' }),
  model: z.string().min(1).default('small').meta({
    label: 'Model size',
    help: 'Larger models are more accurate and slower, for example tiny, small, medium or large-v3.',
  }),
  language: languageField,
});

const responseSchema = z.object({
  segments: z.array(
    z.object({
      startMs: z.number(),
      endMs: z.number(),
      text: z.string(),
      confidence: z.number().optional(),
      words: z
        .array(z.object({ startMs: z.number(), endMs: z.number(), text: z.string() }))
        .optional(),
    }),
  ),
});

export const local = defineTranscriptionProvider({
  id: 'local',
  label: 'Local (faster-whisper)',
  configSchema,
  create: (config, deps) => {
    const headers: Record<string, string> = config.token
      ? { Authorization: `Bearer ${config.token}` }
      : {};
    return {
      async transcribe(audio, options = {}) {
        const response = await request(
          joinUrl(config.baseUrl, '/transcribe'),
          {
            method: 'POST',
            headers,
            body: await audioForm(audio.path, {
              model: config.model,
              language: options.language ?? config.language,
            }),
          },
          {
            provider: 'local',
            fetch: deps.fetch,
            timeoutMs: TRANSCRIBE_TIMEOUT_MS,
            signal: options.signal,
          },
        );
        const data = await parseJson('local', response, responseSchema);
        return data.segments
          .filter((s) => s.text.trim() !== '')
          .map(({ confidence, words, ...s }): Segment => ({
            ...s,
            text: s.text.trim(),
            ...(confidence === undefined ? {} : { confidence }),
            ...(words?.length ? { words: words.map((w) => ({ ...w, text: w.text.trim() })) } : {}),
          }));
      },
      async test() {
        await request(
          joinUrl(config.baseUrl, '/health'),
          { headers },
          { provider: 'local', fetch: deps.fetch, timeoutMs: TEST_TIMEOUT_MS },
        );
        return {};
      },
    };
  },
});
