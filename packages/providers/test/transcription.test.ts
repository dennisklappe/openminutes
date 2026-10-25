import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/errors.js';
import { createTranscriptionProvider } from '../src/registry.js';
import {
  bodyField,
  deps,
  fixedMedia,
  json,
  jsonBody,
  scriptedFetch,
  singleChunkMedia,
  tempAudio,
} from './helpers.js';

describe('openai', () => {
  it('maps whisper-1 verbose_json segments', async () => {
    const { fetch, calls } = scriptedFetch(
      json({
        text: 'hello world',
        segments: [
          { start: 0, end: 1.5, text: ' hello', avg_logprob: -0.1 },
          { start: 1.5, end: 2.25, text: ' world', avg_logprob: 0 },
          { start: 2.25, end: 3, text: '  ' },
        ],
      }),
    );
    const provider = createTranscriptionProvider('openai', { apiKey: 'sk-test' }, deps({ fetch }));
    const segments = await provider.transcribe({ path: await tempAudio() }, { language: 'en' });

    expect(segments).toEqual([
      { startMs: 0, endMs: 1500, text: 'hello', confidence: Math.exp(-0.1) },
      { startMs: 1500, endMs: 2250, text: 'world', confidence: 1 },
    ]);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(calls[0]?.init.headers).toEqual({ Authorization: 'Bearer sk-test' });
    expect(bodyField(calls[0], 'model')).toBe('whisper-1');
    expect(bodyField(calls[0], 'response_format')).toBe('verbose_json');
    expect(bodyField(calls[0], 'language')).toBe('en');
  });

  it('requests word timestamps and attaches the words to their segments', async () => {
    const { fetch, calls } = scriptedFetch(
      json({
        text: 'hello world',
        segments: [
          { start: 0, end: 1, text: ' hello' },
          { start: 3.5, end: 4.5, text: ' world' },
        ],
        words: [
          { word: ' hello', start: 0.1, end: 0.9 },
          { word: ' world', start: 3.6, end: 4.4 },
        ],
      }),
    );
    const provider = createTranscriptionProvider('openai', { apiKey: 'k' }, deps({ fetch }));
    const segments = await provider.transcribe({ path: await tempAudio() });

    const body = calls[0]?.init.body;
    expect(body instanceof FormData && body.getAll('timestamp_granularities[]')).toEqual([
      'segment',
      'word',
    ]);
    expect(segments.map((s) => s.words)).toEqual([
      [{ startMs: 100, endMs: 900, text: 'hello' }],
      [{ startMs: 3600, endMs: 4400, text: 'world' }],
    ]);
  });

  it('offsets word timestamps of later chunks', async () => {
    const { fetch } = scriptedFetch(
      json({
        text: 'a',
        segments: [{ start: 0, end: 1, text: 'a' }],
        words: [{ word: 'a', start: 0.5, end: 0.8 }],
      }),
    );
    const media = fixedMedia([
      { path: await tempAudio('c1.mp3'), offsetMs: 2000, durationMs: 1000 },
    ]);
    const provider = createTranscriptionProvider('openai', { apiKey: 'k' }, deps({ fetch, media }));
    const [segment] = await provider.transcribe({ path: 'ignored.mp3' });

    expect(segment?.words).toEqual([{ startMs: 2500, endMs: 2800, text: 'a' }]);
  });

  it('returns one segment spanning the audio for models without segments', async () => {
    const { fetch, calls } = scriptedFetch(json({ text: ' all of it ' }));
    const provider = createTranscriptionProvider(
      'openai',
      { apiKey: 'k', model: 'gpt-4o-transcribe' },
      deps({ fetch, media: singleChunkMedia(42_000) }),
    );
    const segments = await provider.transcribe({ path: await tempAudio() });

    expect(segments).toEqual([{ startMs: 0, endMs: 42_000, text: 'all of it' }]);
    expect(bodyField(calls[0], 'response_format')).toBe('json');
  });

  it('offsets timestamps of every chunk and cleans up', async () => {
    const { fetch, calls } = scriptedFetch(
      json({ text: 'a', segments: [{ start: 1, end: 2, text: 'one' }] }),
      json({ text: 'b', segments: [{ start: 0.5, end: 1, text: 'two' }] }),
    );
    let cleaned = false;
    const media = fixedMedia(
      [
        { path: await tempAudio('c1.mp3'), offsetMs: 0, durationMs: 3_000_000 },
        { path: await tempAudio('c2.mp3'), offsetMs: 3_000_000, durationMs: 100_000 },
      ],
      () => (cleaned = true),
    );
    const provider = createTranscriptionProvider('openai', { apiKey: 'k' }, deps({ fetch, media }));
    const segments = await provider.transcribe({ path: 'ignored.mp3' });

    expect(segments.map((s) => [s.startMs, s.endMs, s.text])).toEqual([
      [1000, 2000, 'one'],
      [3_000_500, 3_001_000, 'two'],
    ]);
    expect(calls).toHaveLength(2);
    expect(cleaned).toBe(true);
  });

  it('cleans up when a chunk fails', async () => {
    const { fetch } = scriptedFetch(json({}, 429));
    let cleaned = false;
    const media = fixedMedia(
      [{ path: await tempAudio(), offsetMs: 0, durationMs: 1 }],
      () => (cleaned = true),
    );
    const provider = createTranscriptionProvider('openai', { apiKey: 'k' }, deps({ fetch, media }));

    await expect(provider.transcribe({ path: 'x.mp3' })).rejects.toMatchObject({
      code: 'rate_limit',
    });
    expect(cleaned).toBe(true);
  });

  it('tests the key against /models', async () => {
    const { fetch, calls } = scriptedFetch(json({ data: [] }));
    await createTranscriptionProvider('openai', { apiKey: 'k' }, deps({ fetch })).test();
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/models');
  });
});

describe('groq', () => {
  it('uses the Groq endpoint and default model', async () => {
    const { fetch, calls } = scriptedFetch(
      json({ text: 'hi', segments: [{ start: 0, end: 1, text: 'hi' }] }),
    );
    const provider = createTranscriptionProvider('groq', { apiKey: 'gsk' }, deps({ fetch }));
    const segments = await provider.transcribe({ path: await tempAudio() });

    expect(segments).toEqual([{ startMs: 0, endMs: 1000, text: 'hi' }]);
    expect(calls[0]?.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(bodyField(calls[0], 'model')).toBe('whisper-large-v3-turbo');
  });
});

describe('deepgram', () => {
  const response = {
    results: {
      utterances: [
        { start: 0.2, end: 2.1, transcript: 'Hello there.', confidence: 0.98, speaker: 0 },
        { start: 2.5, end: 4, transcript: 'Hi!', confidence: 0.9, speaker: 1 },
      ],
    },
  };

  it('maps utterances with speakers', async () => {
    const { fetch, calls } = scriptedFetch(json(response));
    const provider = createTranscriptionProvider('deepgram', { apiKey: 'dg' }, deps({ fetch }));
    const segments = await provider.transcribe({ path: await tempAudio('a.wav') });

    expect(segments).toEqual([
      { startMs: 200, endMs: 2100, text: 'Hello there.', confidence: 0.98, speaker: 'Speaker 1' },
      { startMs: 2500, endMs: 4000, text: 'Hi!', confidence: 0.9, speaker: 'Speaker 2' },
    ]);
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/v1/listen');
    expect(url.searchParams.get('diarize')).toBe('true');
    expect(url.searchParams.get('detect_language')).toBe('true');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'Token dg',
      'Content-Type': 'audio/wav',
    });
  });

  it('keeps the word times of an utterance', async () => {
    const { fetch } = scriptedFetch(
      json({
        results: {
          utterances: [
            {
              start: 0,
              end: 1,
              transcript: 'Hi there.',
              words: [
                { word: 'hi', punctuated_word: 'Hi', start: 0, end: 0.4 },
                { word: 'there', punctuated_word: 'there.', start: 0.5, end: 1 },
              ],
            },
          ],
        },
      }),
    );
    const provider = createTranscriptionProvider('deepgram', { apiKey: 'dg' }, deps({ fetch }));
    const [segment] = await provider.transcribe({ path: await tempAudio('a.wav') });

    expect(segment?.words).toEqual([
      { startMs: 0, endMs: 400, text: 'Hi' },
      { startMs: 500, endMs: 1000, text: 'there.' },
    ]);
  });

  it('omits speakers when diarization is off and passes the language', async () => {
    const { fetch, calls } = scriptedFetch(json(response));
    const provider = createTranscriptionProvider(
      'deepgram',
      { apiKey: 'dg', diarize: false, language: 'nl' },
      deps({ fetch }),
    );
    const segments = await provider.transcribe({ path: await tempAudio() });

    expect(segments[0]).not.toHaveProperty('speaker');
    expect(new URL(calls[0]?.url ?? '').searchParams.get('language')).toBe('nl');
  });
});

describe('assemblyai', () => {
  const upload = () => json({ upload_url: 'https://cdn.assemblyai.com/upload/abc' });
  const submitted = () => json({ id: 'tr_1', status: 'queued' });

  it('uploads, polls and maps diarized utterances', async () => {
    const { fetch, calls } = scriptedFetch(
      upload(),
      submitted(),
      json({ status: 'processing' }),
      json({
        status: 'completed',
        words: [],
        utterances: [
          { start: 100, end: 2000, text: 'Good morning.', confidence: 0.95, speaker: 'A' },
          { start: 2100, end: 3000, text: 'Morning.', confidence: 0.9, speaker: 'B' },
        ],
      }),
    );
    let sleeps = 0;
    const provider = createTranscriptionProvider(
      'assemblyai',
      { apiKey: 'aai' },
      deps({ fetch, sleep: () => ((sleeps += 1), Promise.resolve()) }),
    );
    const segments = await provider.transcribe({ path: await tempAudio() });

    expect(segments).toEqual([
      { startMs: 100, endMs: 2000, text: 'Good morning.', confidence: 0.95, speaker: 'Speaker A' },
      { startMs: 2100, endMs: 3000, text: 'Morning.', confidence: 0.9, speaker: 'Speaker B' },
    ]);
    expect(sleeps).toBe(1);
    expect(calls[0]?.init.headers).toEqual({ Authorization: 'aai' });
    expect(jsonBody(calls[1])).toEqual({
      audio_url: 'https://cdn.assemblyai.com/upload/abc',
      speaker_labels: true,
      language_detection: true,
    });
    expect(calls[2]?.url).toBe('https://api.assemblyai.com/v2/transcript/tr_1');
  });

  it('groups words into segments when diarization is off', async () => {
    const word = (text: string, start: number, end: number) => ({
      text,
      start,
      end,
      confidence: 0.5,
    });
    const { fetch, calls } = scriptedFetch(
      upload(),
      submitted(),
      json({
        status: 'completed',
        words: [
          word('Hello', 0, 400),
          word('there.', 450, 900),
          word('Second', 1000, 1300),
          word('thought', 1350, 1700),
          word('after', 5000, 5300),
          word('a', 5350, 5400),
          word('pause', 5450, 5800),
        ],
        utterances: null,
      }),
    );
    const provider = createTranscriptionProvider(
      'assemblyai',
      { apiKey: 'aai', diarize: false, language: 'en' },
      deps({ fetch }),
    );
    const segments = await provider.transcribe({ path: await tempAudio() });

    expect(segments.map((s) => [s.startMs, s.endMs, s.text])).toEqual([
      [0, 900, 'Hello there.'],
      [1000, 1700, 'Second thought'],
      [5000, 5800, 'after a pause'],
    ]);
    expect(segments[0]?.words).toEqual([
      { startMs: 0, endMs: 400, text: 'Hello' },
      { startMs: 450, endMs: 900, text: 'there.' },
    ]);
    expect(jsonBody(calls[1])).toMatchObject({
      speaker_labels: false,
      language_code: 'en',
    });
  });

  it('surfaces a failed transcript as a server error', async () => {
    const { fetch } = scriptedFetch(
      upload(),
      submitted(),
      json({ status: 'error', error: 'bad audio' }),
    );
    const provider = createTranscriptionProvider('assemblyai', { apiKey: 'k' }, deps({ fetch }));

    await expect(provider.transcribe({ path: await tempAudio() })).rejects.toMatchObject({
      code: 'server',
      message: 'assemblyai: bad audio',
    });
  });
});

describe('local', () => {
  it('posts to /transcribe and returns the segments', async () => {
    const { fetch, calls } = scriptedFetch(
      json({
        language: 'en',
        segments: [
          { startMs: 0, endMs: 900, text: ' hi ', confidence: 0.8 },
          { startMs: 900, endMs: 1000, text: '' },
        ],
      }),
    );
    const provider = createTranscriptionProvider(
      'local',
      { baseUrl: 'http://whisper:8000/', token: 't', model: 'medium' },
      deps({ fetch }),
    );
    const segments = await provider.transcribe({ path: await tempAudio() }, { language: 'en' });

    expect(segments).toEqual([{ startMs: 0, endMs: 900, text: 'hi', confidence: 0.8 }]);
    expect(calls[0]?.url).toBe('http://whisper:8000/transcribe');
    expect(calls[0]?.init.headers).toEqual({ Authorization: 'Bearer t' });
    expect(bodyField(calls[0], 'model')).toBe('medium');
    expect(bodyField(calls[0], 'language')).toBe('en');
  });

  it('keeps the word times of a segment', async () => {
    const { fetch } = scriptedFetch(
      json({
        language: 'en',
        segments: [
          {
            startMs: 0,
            endMs: 900,
            text: 'hi you',
            words: [
              { startMs: 0, endMs: 400, text: ' hi' },
              { startMs: 500, endMs: 900, text: ' you' },
            ],
          },
        ],
      }),
    );
    const provider = createTranscriptionProvider('local', {}, deps({ fetch }));
    const [segment] = await provider.transcribe({ path: await tempAudio() });

    expect(segment?.words).toEqual([
      { startMs: 0, endMs: 400, text: 'hi' },
      { startMs: 500, endMs: 900, text: 'you' },
    ]);
  });

  it('checks /health', async () => {
    const { fetch, calls } = scriptedFetch(json({ status: 'ok' }));
    await createTranscriptionProvider('local', {}, deps({ fetch })).test();
    expect(calls[0]?.url).toBe('http://whisper:8000/health');
  });

  it('rejects a response that does not match the documented API', async () => {
    const { fetch } = scriptedFetch(json({ results: [] }));
    const provider = createTranscriptionProvider('local', {}, deps({ fetch }));
    await expect(provider.transcribe({ path: await tempAudio() })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('config validation', () => {
  it('rejects a missing key with invalid_config', () => {
    expect(() => createTranscriptionProvider('openai', {})).toThrow(ProviderError);
    expect(() => createTranscriptionProvider('openai', {})).toThrow(/apiKey/);
  });

  it('rejects an unknown provider id', () => {
    expect(() => createTranscriptionProvider('nope', {})).toThrow(/unknown transcription provider/);
  });
});

describe('whisper segment cleaning', () => {
  const run = async (body: unknown) => {
    const { fetch } = scriptedFetch(json(body));
    const provider = createTranscriptionProvider('openai', { apiKey: 'k' }, deps({ fetch }));
    return provider.transcribe({ path: await tempAudio() });
  };

  it('drops segments whisper itself marks as silence or repetition', async () => {
    const segments = await run({
      text: '',
      segments: [
        { start: 0, end: 1, text: ' Real.', no_speech_prob: 0.3, avg_logprob: -0.2 },
        { start: 5, end: 6, text: ' Thank you.', no_speech_prob: 1, avg_logprob: -0.4 },
        { start: 7, end: 8, text: ' Hm.', no_speech_prob: 0.7, avg_logprob: -1.3 },
        { start: 9, end: 10, text: ' la la la', compression_ratio: 3 },
        { start: 11, end: 12, text: ' Quiet.', no_speech_prob: 0.7, avg_logprob: -0.3 },
      ],
    });
    expect(segments.map((s) => s.text)).toEqual(['Real.', 'Quiet.']);
  });

  it('puts the punctuation of the segment on its words and joins split numbers', async () => {
    const [segment] = await run({
      text: '',
      segments: [{ start: 0, end: 3, text: ' Yes, that is 5,000 euros.' }],
      words: [
        { word: 'Yes', start: 0, end: 0.3 },
        { word: 'that', start: 0.4, end: 0.6 },
        { word: 'is', start: 0.6, end: 0.8 },
        { word: '5', start: 0.9, end: 1.2 },
        { word: '000', start: 1.2, end: 1.6 },
        { word: 'euros', start: 1.6, end: 2 },
      ],
    });
    expect(segment?.words?.map((w) => w.text)).toEqual(['Yes,', 'that', 'is', '5,000', 'euros.']);
    expect(segment?.words?.[3]).toMatchObject({ startMs: 900, endMs: 1600 });
  });

  it('keeps a last word timed at zero length with its segment', async () => {
    const segments = await run({
      text: '',
      segments: [
        { start: 0, end: 2, text: ' Back on Friday.' },
        { start: 2.5, end: 3, text: ' Okay.' },
      ],
      words: [
        { word: 'Back', start: 0.5, end: 0.9 },
        { word: 'on', start: 0.9, end: 1.2 },
        { word: 'Friday', start: 2, end: 2 },
        { word: 'Okay', start: 2.5, end: 3 },
      ],
    });
    expect(segments.map((s) => s.words?.map((w) => w.text))).toEqual([
      ['Back', 'on', 'Friday.'],
      ['Okay.'],
    ]);
  });
});
