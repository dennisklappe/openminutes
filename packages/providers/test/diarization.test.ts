import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/errors.js';
import { createLocalDiarizer } from '../src/diarization/local.js';
import { bodyField, json, scriptedFetch, tempAudio } from './helpers.js';

const result = {
  available: true,
  speakers: [{ id: 0, embedding: [0.6, 0.8], durationMs: 9000 }],
  turns: [{ startMs: 0, endMs: 4200, speaker: 0 }],
};

describe('local diarizer', () => {
  it('posts the audio with the token and the speaker count', async () => {
    const { fetch, calls } = scriptedFetch(json(result));
    const diarizer = createLocalDiarizer(
      { baseUrl: 'http://whisper:8000/', token: 't' },
      { fetch },
    );

    const out = await diarizer.diarize({ path: await tempAudio() }, { numSpeakers: 2 });

    expect(out).toEqual({ speakers: result.speakers, turns: result.turns });
    expect(calls[0]?.url).toBe('http://whisper:8000/diarize');
    expect(calls[0]?.init.headers).toEqual({ Authorization: 'Bearer t' });
    expect(bodyField(calls[0], 'num_speakers')).toBe('2');
  });

  it('keeps the similarity and runner-up of a turn', async () => {
    const turn = {
      startMs: 0,
      endMs: 1500,
      speaker: 1,
      similarity: 0.52,
      runnerUp: { speaker: 0, similarity: 0.47 },
    };
    const { fetch } = scriptedFetch(json({ ...result, turns: [turn] }));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    const out = await diarizer.diarize({ path: await tempAudio() });

    expect(out?.turns).toEqual([turn]);
  });

  it('rejects a runner-up without a similarity', async () => {
    const turns = [{ startMs: 0, endMs: 900, speaker: 1, runnerUp: { speaker: 0 } }];
    const { fetch } = scriptedFetch(json({ ...result, turns }));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    await expect(diarizer.diarize({ path: await tempAudio() })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('omits the speaker count when none is given', async () => {
    const { fetch, calls } = scriptedFetch(json(result));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    await diarizer.diarize({ path: await tempAudio() });

    expect(bodyField(calls[0], 'num_speakers')).toBeNull();
    expect(calls[0]?.init.headers).toEqual({});
  });

  it('returns undefined when the service has no model', async () => {
    const { fetch } = scriptedFetch(json({ available: false, reason: 'model missing' }));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    expect(await diarizer.diarize({ path: await tempAudio() })).toBeUndefined();
  });

  it('rejects an unexpected body', async () => {
    const { fetch } = scriptedFetch(json({ speakers: [] }));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    await expect(diarizer.diarize({ path: await tempAudio() })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('reports an HTTP error', async () => {
    const { fetch } = scriptedFetch(json({ detail: 'invalid token' }, 401));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    await expect(diarizer.diarize({ path: await tempAudio() })).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});

describe('local diarizer embed', () => {
  const ranges = [
    { startMs: 1000, endMs: 4000 },
    { startMs: 9000, endMs: 12000 },
  ];

  it('posts the ranges and returns the voice print', async () => {
    const { fetch, calls } = scriptedFetch(
      json({ available: true, embedding: [0.6, 0.8], durationMs: 6000 }),
    );
    const diarizer = createLocalDiarizer(
      { baseUrl: 'http://whisper:8000/', token: 't' },
      { fetch },
    );

    const out = await diarizer.embed({ path: await tempAudio() }, ranges);

    expect(out).toEqual([0.6, 0.8]);
    expect(calls[0]?.url).toBe('http://whisper:8000/embed');
    expect(calls[0]?.init.headers).toEqual({ Authorization: 'Bearer t' });
    expect(bodyField(calls[0], 'ranges')).toBe('[[1000,4000],[9000,12000]]');
  });

  it('returns undefined when no range is long enough', async () => {
    const { fetch } = scriptedFetch(json({ available: true, embedding: null, durationMs: 0 }));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    expect(await diarizer.embed({ path: await tempAudio() }, ranges)).toBeUndefined();
  });

  it('returns undefined when the service has no model', async () => {
    const { fetch } = scriptedFetch(json({ available: false, reason: 'model missing' }));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    expect(await diarizer.embed({ path: await tempAudio() }, ranges)).toBeUndefined();
  });

  it('rejects an unexpected body', async () => {
    const { fetch } = scriptedFetch(json({ embedding: [1] }));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    await expect(diarizer.embed({ path: await tempAudio() }, ranges)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('local diarizer embedEach', () => {
  const ranges = [
    { startMs: 1000, endMs: 4000 },
    { startMs: 9000, endMs: 9200 },
  ];

  it('posts the ranges and returns a print per range with the model name', async () => {
    const { fetch, calls } = scriptedFetch(
      json({ available: true, embeddings: [[0.6, 0.8], null], model: 'nl-model' }),
    );
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000/' }, { fetch });

    const out = await diarizer.embedEach({ path: await tempAudio() }, ranges);

    expect(out).toEqual({ embeddings: [[0.6, 0.8], null], model: 'nl-model' });
    expect(calls[0]?.url).toBe('http://whisper:8000/embed-lines');
    expect(bodyField(calls[0], 'ranges')).toBe('[[1000,4000],[9000,9200]]');
  });

  it('returns undefined when the service has no model', async () => {
    const { fetch } = scriptedFetch(json({ available: false, reason: 'model missing' }));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    expect(await diarizer.embedEach({ path: await tempAudio() }, ranges)).toBeUndefined();
  });

  it('rejects an unexpected body', async () => {
    const { fetch } = scriptedFetch(json({ embeddings: [] }));
    const diarizer = createLocalDiarizer({ baseUrl: 'http://whisper:8000' }, { fetch });

    await expect(diarizer.embedEach({ path: await tempAudio() }, ranges)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});
