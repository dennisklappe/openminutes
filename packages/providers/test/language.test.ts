import { describe, expect, it } from 'vitest';
import { createTranscriptionProvider } from '../src/registry.js';
import { bodyField, deps, json, jsonBody, scriptedFetch, tempAudio } from './helpers.js';

const autoValues = [undefined, '', 'auto'];

const whisperReply = () => json({ text: 'hi', segments: [{ start: 0, end: 1, text: 'hi' }] });

describe('automatic language detection', () => {
  it.each(['openai', 'groq'])('%s sends no language when set to auto', async (id) => {
    for (const language of autoValues) {
      const { fetch, calls } = scriptedFetch(whisperReply());
      const provider = createTranscriptionProvider(id, { apiKey: 'k', language }, deps({ fetch }));
      await provider.transcribe({ path: await tempAudio() });
      expect(bodyField(calls[0], 'language')).toBeNull();
    }
  });

  it('local sends no language when set to auto', async () => {
    for (const language of autoValues) {
      const { fetch, calls } = scriptedFetch(json({ segments: [] }));
      const provider = createTranscriptionProvider('local', { language }, deps({ fetch }));
      await provider.transcribe({ path: await tempAudio() });
      expect(bodyField(calls[0], 'language')).toBeNull();
    }
  });

  it('deepgram asks for language detection when set to auto', async () => {
    for (const language of autoValues) {
      const { fetch, calls } = scriptedFetch(json({ results: { utterances: [] } }));
      const provider = createTranscriptionProvider(
        'deepgram',
        { apiKey: 'k', language },
        deps({ fetch }),
      );
      await provider.transcribe({ path: await tempAudio('a.wav') });
      const params = new URL(calls[0]?.url ?? '').searchParams;
      expect(params.get('detect_language')).toBe('true');
      expect(params.has('language')).toBe(false);
    }
  });

  it('assemblyai asks for language detection when set to auto', async () => {
    for (const language of autoValues) {
      const { fetch, calls } = scriptedFetch(
        json({ upload_url: 'https://cdn/x' }),
        json({ id: 't' }),
        json({ status: 'completed', words: [], utterances: [] }),
      );
      const provider = createTranscriptionProvider(
        'assemblyai',
        { apiKey: 'k', language },
        deps({ fetch }),
      );
      await provider.transcribe({ path: await tempAudio() });
      expect(jsonBody(calls[1])).toMatchObject({ language_detection: true });
      expect(jsonBody(calls[1])).not.toHaveProperty('language_code');
    }
  });
});
