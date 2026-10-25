import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('static UI serving', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;

  beforeAll(async () => {
    test = await createTestDatabase();
    const root = await mkdtemp(join(tmpdir(), 'openminutes-ui-'));
    await mkdir(join(root, 'ui'));
    await writeFile(join(root, 'ui', 'sw.js'), '// worker');
    await writeFile(join(root, 'ui', 'manifest.webmanifest'), '{}');
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, 'a-long-enough-test-secret'),
      storage: new LocalStorage(root),
      secret: 'a-long-enough-test-secret',
      calendarProviders: createProviders(),
      version: '1.0.0',
      queue: { send: () => Promise.resolve() },
      uiRoot: relative(process.cwd(), join(root, 'ui')),
    });
  });
  afterAll(() => test.close());

  it('never lets the browser cache the service worker', async () => {
    const response = await app.request('/sw.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('serves the manifest as a web manifest', async () => {
    const response = await app.request('/manifest.webmanifest');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('manifest');
  });

  it('answers an unknown page with a small HTML 404 and an unknown API path with JSON', async () => {
    const page = await app.request('/no/such/page');
    expect(page.status).toBe(404);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('Page not found');
    const api = await app.request('/api/no-such-route');
    expect(api.status).toBe(404);
    expect(api.headers.get('content-type')).toContain('json');
  });
});
