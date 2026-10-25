import { describe, expect, it } from 'vitest';
import { createLocalLanguageDetector } from '../src/language-detection.js';
import { json, scriptedFetch, tempAudio } from './helpers.js';

describe('local language detector', () => {
  it('posts the audio and returns the language the service voted for', async () => {
    const { fetch, calls } = scriptedFetch(json({ language: 'nl', confidence: 0.93 }));
    const detector = createLocalLanguageDetector(
      { baseUrl: 'http://whisper:8000/', token: 't' },
      { fetch },
    );

    expect(await detector.detect({ path: await tempAudio() })).toEqual({
      language: 'nl',
      confidence: 0.93,
    });
    expect(calls[0]?.url).toBe('http://whisper:8000/detect-language');
    expect(calls[0]?.init.headers).toEqual({ Authorization: 'Bearer t' });
  });

  it('returns nothing when the service is not sure', async () => {
    const { fetch } = scriptedFetch(json({ language: null, confidence: 0.3 }));
    const detector = createLocalLanguageDetector({ baseUrl: 'http://whisper:8000' }, { fetch });

    expect(await detector.detect({ path: await tempAudio() })).toBeUndefined();
  });
});
