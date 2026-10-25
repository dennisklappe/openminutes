import { baseEnvSchema, parseEnv } from '@openminutes/core';
import { z } from 'zod';

const botEnvSchema = baseEnvSchema.extend({
  OPENMINUTES_CHROMIUM_ARGS: z
    .string()
    .default('[]')
    .transform((value) => z.array(z.string()).parse(JSON.parse(value))),
  OPENMINUTES_SEGMENT_SECONDS: z.coerce.number().int().positive().default(3600),
});

export type BotEnv = z.infer<typeof botEnvSchema>;

export const loadBotEnv = (): BotEnv => parseEnv(botEnvSchema);
