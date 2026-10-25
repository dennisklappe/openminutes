import { z } from 'zod';
import { audioForm } from './audio.js';
import { joinUrl, request } from './http.js';
import { parseJson } from './parse.js';
import type { Deps } from './types.js';

const DETECT_TIMEOUT_MS = 30 * 60_000;

const responseSchema = z.object({
  language: z.string().nullable(),
  confidence: z.number(),
});

export interface DetectedLanguage {
  language: string;
  confidence: number;
}

export interface LanguageDetector {
  detect(audio: { path: string }): Promise<DetectedLanguage | undefined>;
}

interface LocalLanguageDetectorConfig {
  baseUrl: string;
  token?: string | undefined;
}

export function createLocalLanguageDetector(
  config: LocalLanguageDetectorConfig,
  deps: Pick<Deps, 'fetch'>,
): LanguageDetector {
  const headers: Record<string, string> = config.token
    ? { Authorization: `Bearer ${config.token}` }
    : {};
  return {
    async detect(audio) {
      const response = await request(
        joinUrl(config.baseUrl, '/detect-language'),
        { method: 'POST', headers, body: await audioForm(audio.path, {}) },
        { provider: 'local-language', fetch: deps.fetch, timeoutMs: DETECT_TIMEOUT_MS },
      );
      const data = await parseJson('local-language', response, responseSchema);
      return data.language ? { language: data.language, confidence: data.confidence } : undefined;
    },
  };
}
