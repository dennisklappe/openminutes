import { z } from 'zod';
import { audioBlob } from '../audio.js';
import { defineTranscriptionProvider } from '../define.js';
import { ProviderError } from '../errors.js';
import { endpoint } from '../field-meta.js';
import { languageField } from '../language.js';
import { joinUrl, request } from '../http.js';
import { parseJson } from '../parse.js';
import type { Segment, SegmentWord } from '../types.js';

const REQUEST_TIMEOUT_MS = 10 * 60_000;
const TEST_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 2 * 60 * 60_000;
const MAX_GAP_MS = 1500;
const MAX_WORDS = 60;

const configSchema = z.object({
  apiKey: z.string().min(1).meta({ label: 'API key' }),
  baseUrl: z.url().default('https://api.assemblyai.com').meta(endpoint('AssemblyAI')),
  language: languageField,
  diarize: z
    .boolean()
    .default(true)
    .meta({ label: 'Identify speakers', help: 'Label who said what from the audio alone.' }),
});

const wordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
});

const uploadSchema = z.object({ upload_url: z.string() });
const submitSchema = z.object({ id: z.string() });
const transcriptSchema = z.object({
  status: z.enum(['queued', 'processing', 'completed', 'error']),
  error: z.string().nullish(),
  words: z.array(wordSchema).nullish(),
  utterances: z
    .array(
      wordSchema.omit({ text: true }).extend({
        text: z.string(),
        speaker: z.string().optional(),
        words: z.array(wordSchema).optional(),
      }),
    )
    .nullish(),
});

type Word = z.infer<typeof wordSchema>;

const toSegmentWord = (w: Word): SegmentWord => ({ startMs: w.start, endMs: w.end, text: w.text });

function average(words: Word[]): number | undefined {
  const scores = words.flatMap((w) => (w.confidence === undefined ? [] : [w.confidence]));
  return scores.length === 0 ? undefined : scores.reduce((a, b) => a + b, 0) / scores.length;
}

function segmentsFromWords(words: Word[]): Segment[] {
  const segments: Segment[] = [];
  let current: Word[] = [];
  const flush = () => {
    const first = current[0];
    const last = current.at(-1);
    if (!first || !last) return;
    const confidence = average(current);
    segments.push({
      startMs: first.start,
      endMs: last.end,
      text: current.map((w) => w.text).join(' '),
      words: current.map(toSegmentWord),
      ...(confidence === undefined ? {} : { confidence }),
    });
    current = [];
  };
  for (const word of words) {
    const previous = current.at(-1);
    if (previous && word.start - previous.end > MAX_GAP_MS) flush();
    current.push(word);
    if (/[.?!]$/.test(word.text) || current.length >= MAX_WORDS) flush();
  }
  flush();
  return segments;
}

export const assemblyai = defineTranscriptionProvider({
  id: 'assemblyai',
  label: 'AssemblyAI',
  configSchema,
  create: (config, deps) => {
    const headers = { Authorization: config.apiKey };
    const call = (path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal) =>
      request(joinUrl(config.baseUrl, path), init, {
        provider: 'assemblyai',
        fetch: deps.fetch,
        timeoutMs,
        signal,
      });

    return {
      async transcribe(audio, options = {}) {
        const upload = await parseJson(
          'assemblyai',
          await call(
            '/v2/upload',
            { method: 'POST', headers, body: await audioBlob(audio.path) },
            REQUEST_TIMEOUT_MS,
            options.signal,
          ),
          uploadSchema,
        );
        const language = options.language ?? config.language;
        const submitted = await parseJson(
          'assemblyai',
          await call(
            '/v2/transcript',
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audio_url: upload.upload_url,
                speaker_labels: config.diarize,
                ...(language ? { language_code: language } : { language_detection: true }),
              }),
            },
            REQUEST_TIMEOUT_MS,
            options.signal,
          ),
          submitSchema,
        );

        for (let waited = 0; waited <= MAX_WAIT_MS; waited += POLL_INTERVAL_MS) {
          const transcript = await parseJson(
            'assemblyai',
            await call(
              `/v2/transcript/${submitted.id}`,
              { headers },
              REQUEST_TIMEOUT_MS,
              options.signal,
            ),
            transcriptSchema,
          );
          if (transcript.status === 'error') {
            throw new ProviderError(
              'assemblyai',
              'server',
              transcript.error ?? 'transcription failed',
            );
          }
          if (transcript.status === 'completed') {
            if (transcript.utterances?.length) {
              return transcript.utterances.map((u): Segment => ({
                startMs: u.start,
                endMs: u.end,
                text: u.text,
                ...(u.words?.length ? { words: u.words.map(toSegmentWord) } : {}),
                ...(u.confidence === undefined ? {} : { confidence: u.confidence }),
                ...(u.speaker ? { speaker: `Speaker ${u.speaker}` } : {}),
              }));
            }
            return segmentsFromWords(transcript.words ?? []);
          }
          await deps.sleep(POLL_INTERVAL_MS, options.signal);
        }
        throw new ProviderError('assemblyai', 'timeout', 'transcription did not finish in time');
      },
      async test() {
        await call('/v2/transcript?limit=1', { headers }, TEST_TIMEOUT_MS);
        return {};
      },
    };
  },
});
