import {
  botNotificationsEnabled,
  clearBotCredentials,
  clearBotSession,
  InvalidBotCredentialsError,
  InvalidBotSessionError,
  loadBotKeepAlive,
  loadBotCredentialsInfo,
  loadBotSessionInfo,
  MAX_BOT_SESSION_BYTES,
  parseBotSession,
  saveBotCredentials,
  saveBotSession,
  setBotNotifications,
  type SettingsStore,
} from '@openminutes/core';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { MicrosoftSessionDto } from '../dto.js';

const credentialsInput = z.object({
  email: z.string().trim().max(254),
  password: z.string().max(256).optional(),
  totpSecret: z.string().max(256).optional(),
});

/** The Microsoft session file and sign-in details Teams joins with (issue #50). */
export function microsoftSessionRoutes({ settings }: { settings: SettingsStore }): Hono {
  const routes = new Hono();

  routes.onError((error, c) => {
    if (error instanceof InvalidBotSessionError || error instanceof InvalidBotCredentialsError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  });

  const read = async (): Promise<MicrosoftSessionDto> => {
    const [{ status, expiresAt }, keepAlive, notify, credentials] = await Promise.all([
      loadBotSessionInfo('microsoft', settings),
      loadBotKeepAlive('microsoft', settings),
      botNotificationsEnabled('microsoft', settings),
      loadBotCredentialsInfo('microsoft', settings),
    ]);
    return {
      status,
      expiresAt: expiresAt?.toISOString() ?? null,
      keepAlive: keepAlive ?? null,
      notify,
      credentials: credentials ?? null,
    };
  };

  routes.get('/bot/microsoft-session', async (c) => c.json(await read()));

  routes.put(
    '/bot/microsoft-session',
    bodyLimit({
      maxSize: MAX_BOT_SESSION_BYTES,
      onError: (c) => c.json({ error: 'The session file must be 1 MB or smaller' }, 413),
    }),
    async (c) => {
      await saveBotSession('microsoft', settings, parseBotSession('microsoft', await c.req.text()));
      return c.json(await read());
    },
  );

  routes.delete('/bot/microsoft-session', async (c) => {
    await clearBotSession('microsoft', settings);
    return c.json(await read());
  });

  routes.put('/bot/microsoft-notifications', async (c) => {
    const body = z.object({ notify: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Send notify as true or false' }, 400);
    await setBotNotifications('microsoft', settings, body.data.notify);
    return c.json(await read());
  });

  routes.put('/bot/microsoft-credentials', async (c) => {
    const body = credentialsInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Enter the bot account email and password' }, 400);
    await saveBotCredentials('microsoft', settings, body.data);
    return c.json(await read());
  });

  routes.delete('/bot/microsoft-credentials', async (c) => {
    await clearBotCredentials('microsoft', settings);
    return c.json(await read());
  });

  return routes;
}
