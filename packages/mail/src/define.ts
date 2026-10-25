import type { ProviderDefinition } from '@openminutes/providers';
import { parseConfig } from '@openminutes/providers';
import type { z } from 'zod';
import type { MailDeps, MailProvider } from './types.js';

export type MailProviderDefinition = Omit<ProviderDefinition<MailProvider>, 'create'> & {
  create(config: unknown, deps: MailDeps): MailProvider;
};

interface Definition<S extends z.ZodType> {
  id: string;
  label: string;
  configSchema: S;
  create(config: z.output<S>, deps: MailDeps): MailProvider;
}

export function defineMailProvider<S extends z.ZodType>(
  definition: Definition<S>,
): MailProviderDefinition {
  return {
    id: definition.id,
    label: definition.label,
    configSchema: definition.configSchema,
    create: (config, deps) =>
      definition.create(parseConfig(definition.id, definition.configSchema, config), deps),
  };
}
