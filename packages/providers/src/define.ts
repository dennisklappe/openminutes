import type { z } from 'zod';
import { parseConfig } from './parse.js';
import type { Deps, SummaryProvider, TranscriptionProvider } from './types.js';

export interface ProviderDefinition<P> {
  id: string;
  label: string;
  configSchema: z.ZodType;
  create(config: unknown, deps: Deps): P;
}

interface Definition<P, S extends z.ZodType> {
  id: string;
  label: string;
  configSchema: S;
  create(config: z.output<S>, deps: Deps): P;
}

function define<P, S extends z.ZodType>(definition: Definition<P, S>): ProviderDefinition<P> {
  return {
    id: definition.id,
    label: definition.label,
    configSchema: definition.configSchema,
    create: (config, deps) =>
      definition.create(parseConfig(definition.id, definition.configSchema, config), deps),
  };
}

export const defineTranscriptionProvider = <S extends z.ZodType>(
  definition: Definition<TranscriptionProvider, S>,
) => define(definition);

export const defineSummaryProvider = <S extends z.ZodType>(
  definition: Definition<SummaryProvider, S>,
) => define(definition);
