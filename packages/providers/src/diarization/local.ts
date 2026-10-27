import { z } from 'zod';
import { audioForm } from '../audio.js';
import { joinUrl, request } from '../http.js';
import { parseJson } from '../parse.js';
import type { Deps } from '../types.js';
import type { Diarizer } from './types.js';

const DIARIZE_TIMEOUT_MS = 60 * 60_000;
const EMBED_TIMEOUT_MS = 10 * 60_000;

const turnSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  speaker: z.number(),
  similarity: z.number().exactOptional(),
  runnerUp: z.object({ speaker: z.number(), similarity: z.number() }).exactOptional(),
});

const responseSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    speakers: z.array(
      z.object({ id: z.number(), embedding: z.array(z.number()), durationMs: z.number() }),
    ),
    turns: z.array(turnSchema),
  }),
  z.object({ available: z.literal(false), reason: z.string().optional() }),
]);

const embedSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    embedding: z.array(z.number()).nullable(),
    durationMs: z.number(),
  }),
  z.object({ available: z.literal(false), reason: z.string().optional() }),
]);

const embedEachSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    embeddings: z.array(z.array(z.number()).nullable()),
    model: z.string().optional(),
  }),
  z.object({ available: z.literal(false), reason: z.string().optional() }),
]);

export interface LocalDiarizerConfig {
  baseUrl: string;
  token?: string | undefined;
}

export function createLocalDiarizer(
  config: LocalDiarizerConfig,
  deps: Pick<Deps, 'fetch'>,
): Diarizer {
  const headers: Record<string, string> = config.token
    ? { Authorization: `Bearer ${config.token}` }
    : {};
  return {
    async diarize(audio, options = {}) {
      const response = await request(
        joinUrl(config.baseUrl, '/diarize'),
        {
          method: 'POST',
          headers,
          body: await audioForm(audio.path, {
            num_speakers:
              options.numSpeakers === undefined ? undefined : String(options.numSpeakers),
          }),
        },
        {
          provider: 'local-diarization',
          fetch: deps.fetch,
          timeoutMs: DIARIZE_TIMEOUT_MS,
          signal: options.signal,
        },
      );
      const data = await parseJson('local-diarization', response, responseSchema);
      return data.available ? { speakers: data.speakers, turns: data.turns } : undefined;
    },
    async embed(audio, ranges) {
      const response = await request(
        joinUrl(config.baseUrl, '/embed'),
        {
          method: 'POST',
          headers,
          body: await audioForm(audio.path, {
            ranges: JSON.stringify(ranges.map((range) => [range.startMs, range.endMs])),
          }),
        },
        { provider: 'local-diarization', fetch: deps.fetch, timeoutMs: EMBED_TIMEOUT_MS },
      );
      const data = await parseJson('local-diarization', response, embedSchema);
      return data.available ? (data.embedding ?? undefined) : undefined;
    },
    async embedEach(audio, ranges) {
      const response = await request(
        joinUrl(config.baseUrl, '/embed-lines'),
        {
          method: 'POST',
          headers,
          body: await audioForm(audio.path, {
            ranges: JSON.stringify(ranges.map((range) => [range.startMs, range.endMs])),
          }),
        },
        { provider: 'local-diarization', fetch: deps.fetch, timeoutMs: EMBED_TIMEOUT_MS },
      );
      const data = await parseJson('local-diarization', response, embedEachSchema);
      return data.available ? { embeddings: data.embeddings, model: data.model } : undefined;
    },
  };
}
