import {
  clearGoogleCredentials,
  clearGoogleSession,
  InvalidGoogleCredentialsError,
  InvalidGoogleSessionError,
  loadGoogleCredentialsInfo,
  loadGoogleSessionInfo,
  loadKeepAlive,
  notificationsEnabled,
  saveGoogleCredentials,
  MAX_GOOGLE_SESSION_BYTES,
  parseGoogleSession,
  saveGoogleSession,
  type SettingsStore,
} from '@openminutes/core';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { GoogleSessionDto } from '../dto.js';

const credentialsInput = z.object({
  email: z.string().trim().max(254),
  password: z.string().max(256).optional(),
  totpSecret: z.string().max(256).optional(),
});

export function googleSessionRoutes({ settings }: { settings: SettingsStore }): Hono {
  const routes = new Hono();

  routes.onError((error, c) => {
    if (
      error instanceof InvalidGoogleSessionError ||
      error instanceof InvalidGoogleCredentialsError
    ) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  });

  const read = async (): Promise<GoogleSessionDto> => {
    const [{ status, expiresAt }, credentials, keepAlive, notify] = await Promise.all([
      loadGoogleSessionInfo(settings),
      loadGoogleCredentialsInfo(settings),
      loadKeepAlive(settings),
      notificationsEnabled(settings),
    ]);
    return {
      status,
      expiresAt: expiresAt?.toISOString() ?? null,
      credentials: credentials ?? null,
      keepAlive: keepAlive ?? null,
      needsAttention: keepAlive?.status === 'needs_attention' || status === 'expired',
      notify,
    };
  };

  routes.get('/bot/google-session', async (c) => c.json(await read()));

  routes.put(
    '/bot/google-session',
    bodyLimit({
      maxSize: MAX_GOOGLE_SESSION_BYTES,
      onError: (c) => c.json({ error: 'The session file must be 1 MB or smaller' }, 413),
    }),
    async (c) => {
      await saveGoogleSession(settings, parseGoogleSession(await c.req.text()));
      return c.json(await read());
    },
  );

  routes.delete('/bot/google-session', async (c) => {
    await clearGoogleSession(settings);
    return c.json(await read());
  });

  routes.put('/bot/google-credentials', async (c) => {
    const body = credentialsInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Enter the bot account email and password' }, 400);
    await saveGoogleCredentials(settings, body.data);
    return c.json(await read());
  });

  routes.delete('/bot/google-credentials', async (c) => {
    await clearGoogleCredentials(settings);
    return c.json(await read());
  });

  routes.put('/bot/google-notifications', async (c) => {
    const body = z.object({ notify: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Send notify as true or false' }, 400);
    await settings.set('bot.google_notify', String(body.data.notify));
    return c.json(await read());
  });

  return routes;
}
