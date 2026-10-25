import { z } from 'zod';
import { defineSummaryProvider } from '../define.js';
import { ProviderError } from '../errors.js';
import { endpoint } from '../field-meta.js';
import { joinUrl, request } from '../http.js';
import { parseJson } from '../parse.js';

const SUMMARIZE_TIMEOUT_MS = 10 * 60_000;
const TEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_INPUT_CHARS = 300_000;
const API_VERSION = '2023-06-01';

const configSchema = z.object({
  apiKey: z.string().min(1).meta({ label: 'API key', placeholder: 'sk-ant-...' }),
  model: z
    .string()
    .min(1)
    .default('claude-sonnet-5-5')
    .meta({ label: 'Model', help: 'The Claude model that writes the summary.' }),
  baseUrl: z.url().default('https://api.anthropic.com').meta(endpoint('Anthropic')),
  maxTokens: z
    .number()
    .int()
    .positive()
    .default(4096)
    .meta({ label: 'Maximum summary length', help: 'In tokens.', advanced: true }),
  maxInputChars: z.number().int().positive().default(DEFAULT_MAX_INPUT_CHARS).meta({
    label: 'Maximum transcript length',
    help: 'In characters. Longer transcripts are summarized in parts first.',
    advanced: true,
  }),
});

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export const anthropic = defineSummaryProvider({
  id: 'anthropic',
  label: 'Anthropic',
  configSchema,
  create: (config, deps) => {
    const headers = { 'x-api-key': config.apiKey, 'anthropic-version': API_VERSION };
    return {
      model: config.model,
      maxInputChars: config.maxInputChars,
      async summarize(transcript, prompt, options = {}) {
        const response = await request(
          joinUrl(config.baseUrl, '/v1/messages'),
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: config.model,
              max_tokens: config.maxTokens,
              system: prompt,
              messages: [{ role: 'user', content: transcript }],
            }),
          },
          {
            provider: 'anthropic',
            fetch: deps.fetch,
            timeoutMs: SUMMARIZE_TIMEOUT_MS,
            signal: options.signal,
          },
        );
        const data = await parseJson('anthropic', response, responseSchema);
        const text = data.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('')
          .trim();
        if (!text) throw new ProviderError('anthropic', 'invalid_response', 'empty completion');
        return text;
      },
      async test() {
        await request(
          joinUrl(config.baseUrl, '/v1/models?limit=1'),
          { headers },
          { provider: 'anthropic', fetch: deps.fetch, timeoutMs: TEST_TIMEOUT_MS },
        );
        return {};
      },
    };
  },
});
