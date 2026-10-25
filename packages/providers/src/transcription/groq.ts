import { z } from 'zod';
import { endpoint } from '../field-meta.js';
import { defineTranscriptionProvider } from '../define.js';
import { languageField } from '../language.js';
import { whisperApiProvider } from './whisper-api.js';

const configSchema = z.object({
  apiKey: z.string().min(1).meta({ label: 'API key', placeholder: 'gsk_...' }),
  model: z
    .string()
    .min(1)
    .default('whisper-large-v3-turbo')
    .meta({
      label: 'Model',
      help: 'Both models give word timestamps. The turbo model is faster and cheaper, large-v3 is a little more accurate.',
      options: [
        { value: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo (recommended)' },
        { value: 'whisper-large-v3', label: 'whisper-large-v3' },
      ],
    }),
  baseUrl: z.url().default('https://api.groq.com/openai/v1').meta(endpoint('Groq')),
  language: languageField,
});

export const groq = defineTranscriptionProvider({
  id: 'groq',
  label: 'Groq',
  configSchema,
  create: (config, deps) =>
    whisperApiProvider({ ...config, provider: 'groq', segmented: true }, deps),
});
