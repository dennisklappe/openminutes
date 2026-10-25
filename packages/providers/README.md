# @openminutes/providers

Pluggable transcription and summary providers. A pure library: no database, no config storage. The caller passes a provider id and a config object and gets back a provider.

```ts
import {
  createTranscriptionProvider,
  createSummaryProvider,
  formatTranscript,
  resolvePrompt,
} from '@openminutes/providers';

const stt = createTranscriptionProvider('groq', { apiKey });
const segments = await stt.transcribe({ path: '/data/audio/meeting.mp3' }, { language: 'en' });

const llm = createSummaryProvider('openai-compatible', {
  baseUrl: 'http://ollama:11434/v1',
  model: 'llama3.1',
});
const summary = await llm.summarize(
  formatTranscript(segments),
  resolvePrompt(customPromptOrUndefined),
);
```

## Providers

Transcription (`transcriptionProviders`):

| id           | Config                                                                    | Notes                                                                                                                    |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `openai`     | `apiKey`, `model` (`whisper-1`), `baseUrl`, `language`                    | `whisper-1` returns segments. `gpt-4o-*` models return text only: one segment spanning the audio                         |
| `groq`       | `apiKey`, `model` (`whisper-large-v3-turbo`), `baseUrl`, `language`       | Same API shape as OpenAI                                                                                                 |
| `deepgram`   | `apiKey`, `model` (`nova-3`), `diarize` (true), `language`                | Utterances with `Speaker N` labels                                                                                       |
| `assemblyai` | `apiKey`, `diarize` (true), `language`                                    | Upload, then poll. Utterances with `Speaker A` labels, or word-level output grouped into sentences when `diarize` is off |
| `local`      | `baseUrl` (`http://whisper:8000`), `token`, `model` (`small`), `language` | Talks to `services/whisper` (see its README for the API)                                                                 |

Summary (`summaryProviders`):

| id                  | Config                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| `none`              | none, `summarize` returns `''`                                                  |
| `openai-compatible` | `baseUrl`, `model`, `apiKey` (optional), `temperature`, `maxInputChars` (24000) |
| `anthropic`         | `apiKey`, `model`, `baseUrl`, `maxTokens` (4096), `maxInputChars` (300000)      |

Every registry entry has `id`, `label` and a zod `configSchema` (for building settings forms and validating stored config). Every provider has `test()`: a cheap authenticated request that spends no tokens, for the settings "test" buttons.

## Large files

OpenAI and Groq reject uploads over 25 MB. Files over 24 MiB are re-encoded by ffmpeg to 48 kbps mono mp3 and split into chunks. Each chunk's real duration is probed with ffprobe, so the timestamps of later chunks are offset by the exact sum of the earlier ones. Chunks are cut at fixed lengths, so a word spoken exactly on a boundary can be split. `ffmpeg` and `ffprobe` must be on `PATH`. Deepgram, AssemblyAI and the local service take the whole file.

## Errors

All failures are a `ProviderError` with `provider`, `code`, optional HTTP `status` and a `retryable` flag:

| code               | Cause                                            |
| ------------------ | ------------------------------------------------ |
| `auth`             | 401 or 403, bad key                              |
| `rate_limit`       | 429                                              |
| `timeout`          | client timeout, 408, 504                         |
| `network`          | connection failure                               |
| `server`           | 5xx, or the provider reported a failed job       |
| `bad_request`      | other 4xx                                        |
| `invalid_response` | the response did not match the documented shape  |
| `invalid_config`   | config failed the schema, or unknown provider id |
| `media`            | ffmpeg or ffprobe failed                         |

A caller-supplied `AbortSignal` is passed through: aborting rejects with the abort reason, not a `ProviderError`.

## Prompts

`prompts/meeting-summary.md` is the default summary prompt (summary, decisions, action items, open questions). It is sent as the system prompt and the transcript as the user message. `resolvePrompt(override)` returns the override when it is non-empty, so a user-edited template in settings wins. `formatTranscript(segments)` renders `[hh:mm:ss] Speaker: text` lines. `formatChat(messages)` renders chat messages the same way, and `chatInstructions` is the text appended to the prompt when a chat block is sent.

The library sends the whole transcript in one request. Each summary provider reports `model` and `maxInputChars` (a config field, so it follows the model you use); the caller splits longer transcripts map-reduce style (the worker does this).

## Testing

`createTranscriptionProvider(id, config, deps)` and `createSummaryProvider` accept partial `deps`: `fetch`, `media` (chunking) and `sleep` (polling). Tests inject a scripted `fetch`; nothing touches the network. See `test/helpers.ts`.

## Adding a provider

One file in `src/transcription/` or `src/summary/`:

```ts
import { z } from 'zod';
import { defineTranscriptionProvider } from '../define.js';
import { audioBlob } from '../audio.js';
import { request } from '../http.js';
import { parseJson } from '../parse.js';

const configSchema = z.object({ apiKey: z.string().min(1) });
const responseSchema = z.object({
  segments: z.array(z.object({ s: z.number(), e: z.number(), t: z.string() })),
});

export const acme = defineTranscriptionProvider({
  id: 'acme',
  label: 'Acme STT',
  configSchema,
  create: (config, deps) => ({
    async transcribe(audio, options = {}) {
      const response = await request(
        'https://api.acme.example/v1/stt',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: await audioBlob(audio.path),
        },
        { provider: 'acme', fetch: deps.fetch, timeoutMs: 600_000, signal: options.signal },
      );
      const data = await parseJson('acme', response, responseSchema);
      return data.segments.map((s) => ({ startMs: s.s, endMs: s.e, text: s.t }));
    },
    async test() {
      await request(
        'https://api.acme.example/v1/me',
        { headers: { Authorization: `Bearer ${config.apiKey}` } },
        { provider: 'acme', fetch: deps.fetch, timeoutMs: 15_000 },
      );
      return {};
    },
  }),
});
```

Then add it to the array in `src/registry.ts` and add a test with a scripted `fetch`. `request` maps HTTP and network failures to `ProviderError`, `parseJson` maps bad bodies to `invalid_response`, and `defineTranscriptionProvider` validates the config before `create` runs.
