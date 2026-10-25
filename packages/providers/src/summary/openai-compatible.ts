import { z } from 'zod';
import { defineSummaryProvider } from '../define.js';
import { joinUrl, request } from '../http.js';
import { ProviderError } from '../errors.js';
import { parseJson } from '../parse.js';

const SUMMARIZE_TIMEOUT_MS = 10 * 60_000;
const TEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_INPUT_CHARS = 24_000;

const configSchema = z.object({
  baseUrl: z.url().meta({
    label: 'Base URL',
    placeholder: 'https://api.openai.com/v1',
    help: 'Any OpenAI-compatible endpoint, for example Ollama at http://host:11434/v1.',
  }),
  model: z.string().min(1).meta({ label: 'Model', placeholder: 'gpt-4o-mini' }),
  apiKey: z
    .string()
    .optional()
    .meta({ label: 'API key', help: 'Leave empty for servers that need no key.' }),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .meta({ label: 'Temperature', help: 'Leave empty for the model default.', advanced: true }),
  maxInputChars: z.number().int().positive().default(DEFAULT_MAX_INPUT_CHARS).meta({
    label: 'Maximum transcript length',
    help: 'In characters. Longer transcripts are summarized in parts first.',
    advanced: true,
  }),
});

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })),
});

export const openaiCompatible = defineSummaryProvider({
  id: 'openai-compatible',
  label: 'OpenAI-compatible (OpenAI, DeepSeek, Ollama, OpenRouter)',
  configSchema,
  create: (config, deps) => {
    const headers: Record<string, string> = config.apiKey
      ? { Authorization: `Bearer ${config.apiKey}` }
      : {};
    return {
      model: config.model,
      maxInputChars: config.maxInputChars,
      async summarize(transcript, prompt, options = {}) {
        const response = await request(
          joinUrl(config.baseUrl, '/chat/completions'),
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: config.model,
              ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
              messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: transcript },
              ],
            }),
          },
          {
            provider: 'openai-compatible',
            fetch: deps.fetch,
            timeoutMs: SUMMARIZE_TIMEOUT_MS,
            signal: options.signal,
          },
        );
        const data = await parseJson('openai-compatible', response, responseSchema);
        const content = data.choices[0]?.message.content?.trim();
        if (!content) {
          throw new ProviderError('openai-compatible', 'invalid_response', 'empty completion');
        }
        return content;
      },
      async test() {
        await request(
          joinUrl(config.baseUrl, '/models'),
          { headers },
          { provider: 'openai-compatible', fetch: deps.fetch, timeoutMs: TEST_TIMEOUT_MS },
        );
        return {};
      },
    };
  },
});
