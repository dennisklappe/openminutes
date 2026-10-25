import { z } from 'zod';

export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENMINUTES_SECRET: z.string().min(16, 'OPENMINUTES_SECRET must be at least 16 characters'),
  OPENMINUTES_DATA_DIR: z.string().min(1).default('./data'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  }
  return result.data;
}
