import { ProviderError, type FetchLike } from '@openminutes/providers';
import type { MailProviderDefinition } from './define.js';
import { emailit } from './providers/emailit.js';
import { gmail } from './providers/gmail.js';
import { smtp } from './providers/smtp.js';
import type { MailDeps, MailProvider } from './types.js';

export const mailProviders: Record<string, MailProviderDefinition> = Object.fromEntries(
  [smtp, emailit, gmail].map((p) => [p.id, p]),
);

export function createMailProvider(
  id: string,
  config: unknown,
  deps: Partial<MailDeps> = {},
): MailProvider {
  const definition = mailProviders[id];
  if (!definition) throw new ProviderError(id, 'invalid_config', 'unknown mail provider');
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  return definition.create(config, { ...deps, fetch: fetchImpl });
}
