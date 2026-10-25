import { BOT_DEFAULTS, LocalStorage, SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import { Hono } from 'hono';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BotSettingsDto } from '../dto.js';
import { botRoutes } from './bot.js';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('bot settings API', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: LocalStorage;
  let app: Hono;

  beforeAll(async () => {
    test = await createTestDatabase();
    storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-bot-settings-')));
    app = new Hono().route(
      '/',
      botRoutes({ settings: new SettingsStore(test.db, 'a-long-enough-test-secret'), storage }),
    );
  });
  afterAll(() => test.close());

  const send = (
    method: string,
    path: string,
    body?: string | Uint8Array,
    type = 'application/json',
  ) =>
    app.request(path, {
      method,
      ...(body !== undefined && { headers: { 'content-type': type }, body }),
    });
  const save = (body: unknown) => send('PUT', '/bot', JSON.stringify(body));
  const read = async () => (await send('GET', '/bot')).json() as Promise<BotSettingsDto>;

  it('starts on the defaults with no camera image', async () => {
    expect(await read()).toEqual({
      name: BOT_DEFAULTS.name,
      joinMessage: BOT_DEFAULTS.joinMessage,
      joinMessageEnabled: true,
      hasCameraImage: false,
      defaults: { name: BOT_DEFAULTS.name, joinMessage: BOT_DEFAULTS.joinMessage },
    });
    expect((await send('GET', '/bot/camera')).status).toBe(404);
  });

  it('saves a custom name and message, trimmed, and lets the message be cleared', async () => {
    const saved = await save({ name: ' Acme Notes ', joinMessage: 'Recording for Acme' });
    expect(await saved.json()).toMatchObject({
      name: 'Acme Notes',
      joinMessage: 'Recording for Acme',
    });
    await save({ name: 'Acme Notes', joinMessage: '' });
    expect(await read()).toMatchObject({
      name: 'Acme Notes',
      joinMessage: BOT_DEFAULTS.joinMessage,
      joinMessageEnabled: false,
    });
  });

  it('switches the join message off and on while keeping the text', async () => {
    await save({ name: 'Acme Notes', joinMessage: 'Hi from {{name}}', joinMessageEnabled: false });
    expect(await read()).toMatchObject({
      joinMessage: 'Hi from {{name}}',
      joinMessageEnabled: false,
    });
    await save({ name: 'Acme Notes', joinMessage: 'Hi from {{name}}', joinMessageEnabled: true });
    expect(await read()).toMatchObject({
      joinMessage: 'Hi from {{name}}',
      joinMessageEnabled: true,
    });
  });

  it('rejects multi-line, oversized and malformed input', async () => {
    expect((await save({ name: 'a\nb', joinMessage: '' })).status).toBe(400);
    expect((await save({ name: 'x'.repeat(65), joinMessage: '' })).status).toBe(400);
    expect((await save({ name: 'ok' })).status).toBe(400);
    expect((await read()).name).toBe('Acme Notes');
  });

  it('stores a PNG or JPEG camera image and serves it back', async () => {
    const saved = await send('PUT', '/bot/camera', png, 'image/png');
    expect(((await saved.json()) as BotSettingsDto).hasCameraImage).toBe(true);
    expect(await readFile(storage.absolutePath('bot/camera.png'))).toEqual(Buffer.from(png));
    expect((await send('GET', '/bot/camera')).headers.get('content-type')).toBe('image/png');

    await send('PUT', '/bot/camera', jpeg, 'image/jpeg');
    expect(await storage.exists('bot/camera.png')).toBe(false);
    expect((await send('GET', '/bot/camera')).headers.get('content-type')).toBe('image/jpeg');
  });

  it('rejects other files and oversized images', async () => {
    expect((await send('PUT', '/bot/camera', 'GIF89a not an image', 'image/png')).status).toBe(400);
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(png);
    expect((await send('PUT', '/bot/camera', big, 'image/png')).status).toBe(413);
    expect((await read()).hasCameraImage).toBe(true);
  });

  it('removes the camera image', async () => {
    const removed = (await (await send('DELETE', '/bot/camera')).json()) as BotSettingsDto;
    expect(removed.hasCameraImage).toBe(false);
    expect(await storage.exists('bot/camera.jpg')).toBe(false);
  });
});
