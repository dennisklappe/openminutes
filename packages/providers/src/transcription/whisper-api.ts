import { audioForm } from '../audio.js';
import { request, joinUrl } from '../http.js';
import { parseJson } from '../parse.js';
import type {
  Chunk,
  Deps,
  Segment,
  TestResult,
  TranscribeOptions,
  TranscriptionProvider,
} from '../types.js';
import { segmentsFromVerbose, verboseResponse } from './verbose.js';
import { transcribeInChunks, UPLOAD_LIMIT_BYTES } from './chunked.js';

const TRANSCRIBE_TIMEOUT_MS = 10 * 60_000;
const TEST_TIMEOUT_MS = 15_000;

interface WhisperApiConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  language?: string | undefined;
  segmented: boolean;
}

export function whisperApiProvider(config: WhisperApiConfig, deps: Deps): TranscriptionProvider {
  const auth = { Authorization: `Bearer ${config.apiKey}` };

  async function transcribeChunk(chunk: Chunk, options: TranscribeOptions): Promise<Segment[]> {
    const body = await audioForm(chunk.path, {
      model: config.model,
      response_format: config.segmented ? 'verbose_json' : 'json',
      'timestamp_granularities[]': config.segmented ? ['segment', 'word'] : undefined,
      language: options.language ?? config.language,
    });
    const response = await request(
      joinUrl(config.baseUrl, '/audio/transcriptions'),
      { method: 'POST', headers: auth, body },
      {
        provider: config.provider,
        fetch: deps.fetch,
        timeoutMs: TRANSCRIBE_TIMEOUT_MS,
        signal: options.signal,
      },
    );
    const data = await parseJson(config.provider, response, verboseResponse);
    if (data.segments) return segmentsFromVerbose({ ...data, segments: data.segments });
    const text = data.text.trim();
    return text === '' ? [] : [{ startMs: 0, endMs: chunk.durationMs, text }];
  }

  return {
    transcribe: (audio, options = {}) =>
      transcribeInChunks(
        deps,
        audio.path,
        UPLOAD_LIMIT_BYTES,
        (chunk) => transcribeChunk(chunk, options),
        options.onProgress,
      ),
    async test(): Promise<TestResult> {
      await request(
        joinUrl(config.baseUrl, '/models'),
        { headers: auth },
        { provider: config.provider, fetch: deps.fetch, timeoutMs: TEST_TIMEOUT_MS },
      );
      return {};
    },
  };
}
