import {
  BOT_DEFAULTS,
  loadBotProfile,
  loadJoinMessage,
  type LocalStorage,
  type SettingsStore,
} from '@openminutes/core';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { BotSettingsDto } from '../dto.js';
import { detectImage } from './image.js';

const MAX_CAMERA_IMAGE_BYTES = 2 * 1024 * 1024;
const CAMERA_PATHS = ['bot/camera.png', 'bot/camera.jpg'];

interface BotDeps {
  settings: SettingsStore;
  storage: LocalStorage;
}

const singleLine = z.string().regex(/^[^\p{Cc}]*$/u, 'Must be a single line of plain text');
const input = z.object({
  name: singleLine.max(64),
  joinMessage: singleLine.max(500),
  joinMessageEnabled: z.boolean().optional(),
});

class InvalidBotSettingsError extends Error {}

export function botRoutes({ settings, storage }: BotDeps): Hono {
  const routes = new Hono();

  routes.onError((error, c) => {
    if (error instanceof InvalidBotSettingsError) return c.json({ error: error.message }, 400);
    throw error;
  });

  const read = async (): Promise<BotSettingsDto> => {
    const [name, joinMessage, cameraImage] = await Promise.all([
      settings.get('bot.name'),
      loadJoinMessage(settings),
      settings.get('bot.camera_image'),
    ]);
    return {
      name: name ?? BOT_DEFAULTS.name,
      joinMessage: joinMessage.message,
      joinMessageEnabled: joinMessage.enabled,
      hasCameraImage: cameraImage !== undefined && (await storage.exists(cameraImage)),
      defaults: { name: BOT_DEFAULTS.name, joinMessage: BOT_DEFAULTS.joinMessage },
    };
  };

  const clearCamera = async () => {
    await Promise.all(CAMERA_PATHS.map((path) => storage.remove(path)));
    await settings.delete('bot.camera_image');
  };

  routes.get('/bot', async (c) => c.json(await read()));

  routes.put('/bot', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw new InvalidBotSettingsError(body.error.issues.map((i) => i.message).join('; '));
    }
    await settings.set('bot.name', body.data.name.trim());
    const message = body.data.joinMessage.trim();
    await settings.set('bot.join_message', message);
    await settings.set(
      'bot.join_message_enabled',
      String(body.data.joinMessageEnabled ?? message !== ''),
    );
    return c.json(await read());
  });

  routes.put(
    '/bot/camera',
    bodyLimit({
      maxSize: MAX_CAMERA_IMAGE_BYTES,
      onError: (c) => c.json({ error: 'The image must be 2 MB or smaller' }, 413),
    }),
    async (c) => {
      const data = new Uint8Array(await c.req.arrayBuffer());
      const kind = detectImage(data);
      if (!kind) throw new InvalidBotSettingsError('The image must be a PNG or JPEG file');
      await clearCamera();
      const path = `bot/camera.${kind}`;
      await storage.write(path, data);
      await settings.set('bot.camera_image', path);
      return c.json(await read());
    },
  );

  routes.delete('/bot/camera', async (c) => {
    await clearCamera();
    return c.json(await read());
  });

  routes.get('/bot/camera', async (c) => {
    const { cameraImagePath } = await loadBotProfile(settings, storage);
    if (cameraImagePath === null) return c.json({ error: 'No camera image' }, 404);
    const file = await readFile(cameraImagePath);
    c.header('content-type', detectImage(file) === 'jpg' ? 'image/jpeg' : 'image/png');
    c.header('cache-control', 'no-store');
    return c.body(file);
  });

  return routes;
}
