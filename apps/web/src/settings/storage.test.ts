import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { startFakeS3, type FakeS3 } from '@openminutes/core/testing';
import { settings as settingsTable } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LimitsDto, ProviderTestDto, StorageSettingsDto, WizardDto } from '../dto.js';
import { limitsRoutes } from './limits.js';
import { storageRoutes } from './storage.js';
import { wizardRoutes } from './wizard.js';

describe('storage, limits and wizard settings API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let s3: FakeS3;
  let root: string;

  beforeAll(async () => {
    test = await createTestDatabase();
    s3 = await startFakeS3({ bucket: 'openminutes', accessKeyId: 'AKIATEST' });
    root = await mkdtemp(join(tmpdir(), 'openminutes-storage-settings-'));
    const settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
    app = new Hono()
      .route('/storage', storageRoutes({ settings, storage: new LocalStorage(root) }))
      .route('/limits', limitsRoutes({ settings }))
      .route('/wizard', wizardRoutes({ settings }));
  });
  afterAll(async () => {
    await test.close();
    await s3.close();
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
  const s3Form = (overrides: Record<string, string> = {}) => ({
    endpoint: s3.endpoint,
    bucket: 'openminutes',
    region: 'us-east-1',
    accessKeyId: 'AKIATEST',
    secretAccessKey: 'shh-secret',
    ...overrides,
  });
  const storage = async () => (await send('GET', '/storage')).json() as Promise<StorageSettingsDto>;

  it('defaults to the local volume with retention off', async () => {
    expect(await storage()).toMatchObject({
      backend: 'local',
      localPath: root,
      retentionDays: null,
      s3: { hasSecretAccessKey: false },
    });
  });

  it('tests a bucket by writing, reading and deleting a probe object', async () => {
    const good = await send('POST', '/storage/test', {
      backend: 's3',
      s3: s3Form(),
      retentionDays: null,
    });
    expect((await good.json()) as ProviderTestDto).toMatchObject({ ok: true });
    expect(s3.objects.size).toBe(0);

    const bad = await send('POST', '/storage/test', {
      backend: 's3',
      s3: s3Form({ accessKeyId: 'WRONG' }),
      retentionDays: null,
    });
    expect((await bad.json()) as ProviderTestDto).toMatchObject({ ok: false });

    const incomplete = await send('POST', '/storage/test', {
      backend: 's3',
      s3: s3Form({ bucket: '' }),
      retentionDays: null,
    });
    expect(incomplete.status).toBe(400);
  });

  it('saves the bucket, keeps the secret out of responses and reuses it when left blank', async () => {
    const saved = await send('PUT', '/storage', {
      backend: 's3',
      s3: s3Form(),
      retentionDays: 30,
    });
    const dto = (await saved.json()) as StorageSettingsDto;
    expect(dto).toMatchObject({
      backend: 's3',
      retentionDays: 30,
      s3: { bucket: 'openminutes', accessKeyId: 'AKIATEST', hasSecretAccessKey: true },
    });
    expect(JSON.stringify(dto)).not.toContain('shh-secret');

    const [row] = await test.db.select().from(settingsTable);
    expect(JSON.stringify(row)).not.toContain('shh-secret');

    const blank = await send('POST', '/storage/test', {
      backend: 's3',
      s3: s3Form({ secretAccessKey: '' }),
      retentionDays: null,
    });
    expect((await blank.json()) as ProviderTestDto).toMatchObject({ ok: true });
  });

  it('switches back to local, and turns retention off with null', async () => {
    await send('PUT', '/storage', { backend: 'local', s3: s3Form(), retentionDays: null });
    expect(await storage()).toMatchObject({ backend: 'local', retentionDays: null });
  });

  it('rejects retention that is not a whole number of days', async () => {
    for (const retentionDays of [0, 1.5, 100000]) {
      const response = await send('PUT', '/storage', {
        backend: 'local',
        s3: s3Form(),
        retentionDays,
      });
      expect(response.status).toBe(400);
    }
  });

  it('exposes and validates the meeting limits', async () => {
    expect((await (await send('GET', '/limits')).json()) as LimitsDto).toEqual({
      lobbyTimeoutSeconds: 600,
      aloneTimeoutSeconds: 60,
      maxDurationMinutes: 240,
      maxConcurrent: 1,
    });
    const saved = await send('PUT', '/limits', {
      lobbyTimeoutSeconds: 300,
      aloneTimeoutSeconds: 120,
      maxDurationMinutes: 90,
      maxConcurrent: 3,
    });
    expect((await saved.json()) as LimitsDto).toEqual({
      lobbyTimeoutSeconds: 300,
      aloneTimeoutSeconds: 120,
      maxDurationMinutes: 90,
      maxConcurrent: 3,
    });
    const tooMany = await send('PUT', '/limits', {
      lobbyTimeoutSeconds: 300,
      aloneTimeoutSeconds: 120,
      maxDurationMinutes: 90,
      maxConcurrent: 99,
    });
    expect(tooMany.status).toBe(400);
  });

  it('remembers the wizard step and whether it is finished', async () => {
    expect((await (await send('GET', '/wizard')).json()) as WizardDto).toEqual({
      completed: true,
      step: 'transcription',
    });
    const reopened = await send('PUT', '/wizard', { completed: false, step: 'storage' });
    expect((await reopened.json()) as WizardDto).toEqual({ completed: false, step: 'storage' });
    expect((await send('PUT', '/wizard', { step: 'nowhere' })).status).toBe(400);
  });
});
