import { describe, expect, it } from 'vitest';
import { ProviderError, type ProviderErrorCode } from '../src/errors.js';
import { createSummaryProvider, createTranscriptionProvider } from '../src/registry.js';
import { deps, json, scriptedFetch, tempAudio } from './helpers.js';

const transcription = {
  openai: { apiKey: 'k' },
  groq: { apiKey: 'k' },
  deepgram: { apiKey: 'k' },
  assemblyai: { apiKey: 'k' },
  local: {},
};

const summary = {
  'openai-compatible': { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
  anthropic: { apiKey: 'k' },
};

const failures: [string, () => Response | Error, ProviderErrorCode, number | undefined][] = [
  ['bad key (401)', () => json({ error: 'invalid key' }, 401), 'auth', 401],
  ['forbidden (403)', () => json({}, 403), 'auth', 403],
  ['rate limit (429)', () => json({}, 429), 'rate_limit', 429],
  ['bad request (400)', () => json({}, 400), 'bad_request', 400],
  ['server error (503)', () => json({}, 503), 'server', 503],
  ['gateway timeout (504)', () => json({}, 504), 'timeout', 504],
  ['client timeout', () => new DOMException('timed out', 'TimeoutError'), 'timeout', undefined],
  ['connection failure', () => new TypeError('fetch failed'), 'network', undefined],
];

describe.each(failures)('%s', (_name, failure, code, status) => {
  it.each(Object.entries(transcription))('transcription %s test()', async (id, config) => {
    const { fetch } = scriptedFetch(failure());
    const error = await createTranscriptionProvider(id, config, deps({ fetch }))
      .test()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ provider: id, code, status });
  });

  it.each(Object.entries(transcription))('transcription %s transcribe()', async (id, config) => {
    const { fetch } = scriptedFetch(failure());
    const path = await tempAudio();
    const error = await createTranscriptionProvider(id, config, deps({ fetch }))
      .transcribe({ path })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ provider: id, code, status });
  });

  it.each(Object.entries(summary))('summary %s summarize()', async (id, config) => {
    const { fetch } = scriptedFetch(failure());
    const error = await createSummaryProvider(id, config, deps({ fetch }))
      .summarize('text', 'prompt')
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ provider: id, code, status });
  });
});

describe('ProviderError', () => {
  it('marks transient codes as retryable', () => {
    expect(new ProviderError('p', 'rate_limit', 'x').retryable).toBe(true);
    expect(new ProviderError('p', 'auth', 'x').retryable).toBe(false);
  });

  it('includes a trimmed response body in the message', async () => {
    const { fetch } = scriptedFetch(new Response('x'.repeat(1000), { status: 500 }));
    const error = await createSummaryProvider('anthropic', { apiKey: 'k' }, deps({ fetch }))
      .test()
      .catch((e: unknown) => e);

    expect((error as ProviderError).message.length).toBeLessThan(400);
  });

  it('lets a caller abort pass through untouched', async () => {
    const controller = new AbortController();
    const abort = new DOMException('aborted', 'AbortError');
    const fetch = () => {
      controller.abort();
      return Promise.reject(abort);
    };
    const provider = createSummaryProvider('anthropic', { apiKey: 'k' }, deps({ fetch }));

    await expect(provider.summarize('t', 'p', { signal: controller.signal })).rejects.toBe(abort);
  });
});
