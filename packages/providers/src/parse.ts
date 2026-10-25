import type { z } from 'zod';
import { ProviderError } from './errors.js';

export async function parseJson<S extends z.ZodType>(
  provider: string,
  response: Response,
  schema: S,
): Promise<z.output<S>> {
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ProviderError(provider, 'invalid_response', 'unexpected response shape');
  }
  return parsed.data;
}

export function parseConfig<S extends z.ZodType>(
  provider: string,
  schema: S,
  config: unknown,
): z.output<S> {
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`);
    throw new ProviderError(provider, 'invalid_config', issues.join('; '));
  }
  return parsed.data;
}
