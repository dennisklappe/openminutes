import { SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UpdateStatusDto } from '../dto.js';
import { isNewer, RELEASES_URL, UpdateChecker } from './checker.js';
import { updateRoutes } from './routes.js';

const DAY = 24 * 60 * 60 * 1000;

describe('isNewer', () => {
  it('compares versions numerically and ignores a leading v', () => {
    expect(isNewer('v0.10.0', '0.9.3')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.1.1')).toBe(false);
  });
});

describe('update notice', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  let app: Hono;
  let time = 0;
  let fetched: { url: string; init: RequestInit | undefined }[] = [];
  let reply: () => Response;

  const release = (tag: string) =>
    new Response(JSON.stringify({ tag_name: tag, html_url: `https://example.test/${tag}` }));
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
  const status = async () => (await send('GET', '/')).json() as Promise<UpdateStatusDto>;

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
    const updates = new UpdateChecker({
      settings,
      version: '0.1.0',
      now: () => time,
      fetch: (url, init) => {
        fetched.push({ url: typeof url === 'string' ? url : '', init });
        return Promise.resolve(reply());
      },
    });
    app = new Hono().route('/', updateRoutes({ settings, updates }));
  });
  afterAll(() => test.close());

  beforeEach(async () => {
    fetched = [];
    time = 10 * DAY;
    reply = () => release('v0.2.0');
    await settings.set('updates.enabled', 'false');
    await settings.set('updates.latest', '{"checkedAt":0}');
    await settings.set('updates.dismissed', '');
  });

  it('is off by default and never makes a request', async () => {
    expect(await status()).toEqual({ enabled: false, current: '0.1.0', available: false });
    expect(fetched).toEqual([]);
  });

  it('asks the public releases API once a day and sends nothing identifying', async () => {
    await send('PUT', '/', { enabled: true });
    expect(await status()).toMatchObject({
      enabled: true,
      available: true,
      latest: '0.2.0',
      url: 'https://example.test/v0.2.0',
    });
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.url).toBe(RELEASES_URL);
    expect(fetched[0]?.init?.body).toBeUndefined();
    expect(fetched[0]?.init?.headers).toEqual({
      accept: 'application/vnd.github+json',
      'user-agent': 'openminutes-update-check',
    });

    await status();
    expect(fetched).toHaveLength(1);
    time += DAY + 1;
    await status();
    expect(fetched).toHaveLength(2);
  });

  it('ignores a release whose link is not https', async () => {
    reply = () =>
      new Response(JSON.stringify({ tag_name: 'v0.2.0', html_url: 'javascript:alert(1)' }));
    await send('PUT', '/', { enabled: true });
    expect(await status()).toMatchObject({ enabled: true, available: false });
  });

  it('shares one request between concurrent callers', async () => {
    await send('PUT', '/', { enabled: true });
    await Promise.all([status(), status(), status()]);
    expect(fetched).toHaveLength(1);
  });

  it('stays quiet when already up to date', async () => {
    reply = () => release('v0.1.0');
    await send('PUT', '/', { enabled: true });
    expect((await status()).available).toBe(false);
  });

  it('hides a dismissed release but shows the next one', async () => {
    await send('PUT', '/', { enabled: true });
    await send('POST', '/dismiss', { version: '0.2.0' });
    expect((await status()).available).toBe(false);
    reply = () => release('v0.3.0');
    time += DAY + 1;
    expect(await status()).toMatchObject({ available: true, latest: '0.3.0' });
  });

  it('keeps working and waits a day after a failed check', async () => {
    reply = () => new Response('rate limited', { status: 403 });
    await send('PUT', '/', { enabled: true });
    expect(await status()).toEqual({ enabled: true, current: '0.1.0', available: false });
    await status();
    expect(fetched).toHaveLength(1);
  });

  it('rejects malformed requests', async () => {
    expect((await send('PUT', '/', { enabled: 'yes' })).status).toBe(400);
    expect((await send('POST', '/dismiss', {})).status).toBe(400);
  });
});
