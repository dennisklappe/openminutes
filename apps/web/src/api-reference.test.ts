import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { keyForbidden } from './auth/api-keys.js';

const REFERENCE = new URL('../../../docs/api-reference.md', import.meta.url);
const PUBLIC = new Set([
  'GET /api/version',
  'GET /api/session',
  'POST /api/setup',
  'POST /api/login',
  'POST /api/logout',
  'GET /api/oauth/callback',
  'GET /api/oauth/:provider/callback',
]);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

describe('docs/api-reference.md', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let rendered: string;

  beforeAll(async () => {
    test = await createTestDatabase();
    const app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, 'a-long-enough-test-secret'),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-ref-'))),
      secret: 'a-long-enough-test-secret',
      calendarProviders: createProviders(),
      version: '0.0.0',
      queue: { send: () => Promise.resolve() },
    });
    const seen = new Set<string>();
    for (const route of app.routes) {
      if (route.path.startsWith('/api/') && METHODS.includes(route.method)) {
        seen.add(`${route.method} ${route.path}`);
      }
    }
    const groups = new Map<string, string[]>();
    for (const entry of [...seen].sort((a, b) =>
      a.split(' ')[1]!.localeCompare(b.split(' ')[1]!),
    )) {
      const [method = '', path = ''] = entry.split(' ');
      const group = path.split('/')[2] ?? '';
      const note = PUBLIC.has(entry)
        ? 'Public'
        : keyForbidden(path)
          ? 'Browser session only'
          : method === 'GET'
            ? 'Read or full key'
            : 'Full key';
      groups.set(group, [
        ...(groups.get(group) ?? []),
        `| \`${method}\` | \`${path}\` | ${note} |`,
      ]);
    }
    rendered = [
      '# API endpoint reference',
      '',
      'Generated from the route table by `apps/web/src/api-reference.test.ts`. Run `UPDATE_API_REFERENCE=1 pnpm --filter @openminutes/web test -- api-reference` after changing a route. It lists method and path only: request bodies are validated by each route, see the types in `apps/web/src/dto.ts` and the common calls in [API](api.md). The API follows the app and may change between minor versions until 1.0, except the endpoints documented in [API](api.md).',
      '',
      ...[...groups].flatMap(([group, rows]) => [
        `## ${group}`,
        '',
        '| Method | Path | Access |',
        '| ------ | ---- | ------ |',
        ...rows,
        '',
      ]),
    ].join('\n');
  });
  afterAll(() => test.close());

  it('lists every route', async () => {
    if (process.env['UPDATE_API_REFERENCE']) await writeFile(REFERENCE, rendered);
    expect(rendered).toContain('/api/meetings/:id');
    expect(await readFile(REFERENCE, 'utf8')).toBe(rendered);
  });
});
