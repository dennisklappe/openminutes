import { z } from 'zod';
import { endpoint } from '../field-meta.js';
import { defineTranscriptionProvider } from '../define.js';
import { languageField } from '../language.js';
import { whisperApiProvider } from './whisper-api.js';

const configSchema = z.object({
  apiKey: z.string().min(1).meta({ label: 'API key', placeholder: 'sk-...' }),
  model: z
    .string()
    .min(1)
    .default('whisper-1')
    .meta({
      label: 'Model',
      help: 'whisper-1 gives word timestamps, which speaker names need. The gpt-4o models are a little more accurate but give none, so speakers are matched per segment and the start and end of the recording are not trimmed.',
      options: [
        { value: 'whisper-1', label: 'whisper-1 (recommended)' },
        { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
        { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe' },
      ],
    }),
  baseUrl: z.url().default('https://api.openai.com/v1').meta(endpoint('OpenAI')),
  language: languageField,
});

export const openai = defineTranscriptionProvider({
  id: 'openai',
  label: 'OpenAI',
  configSchema,
  create: (config, deps) =>
    whisperApiProvider(
      { ...config, provider: 'openai', segmented: config.model === 'whisper-1' },
      deps,
    ),
});
