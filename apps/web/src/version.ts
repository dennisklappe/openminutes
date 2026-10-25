import { readFileSync } from 'node:fs';
import { z } from 'zod';

const manifest = z.object({ version: z.string() });

export function readVersion(env: Record<string, string | undefined> = process.env): string {
  if (env['OPENMINUTES_VERSION']) return env['OPENMINUTES_VERSION'];
  const file = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return manifest.parse(JSON.parse(file)).version;
}
