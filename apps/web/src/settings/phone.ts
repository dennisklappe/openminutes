import {
  DEFAULT_PHONE_CONSENT_TEXT,
  loadPhoneConfig,
  MAX_PHONE_CONSENT_LENGTH,
  savePhoneConfig,
  type SettingsStore,
} from '@openminutes/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { PhoneConfigDto, PhoneSettingsDto } from '../dto.js';

const input = z.object({
  enabled: z.boolean(),
  consentText: z.string().max(MAX_PHONE_CONSENT_LENGTH),
});

export function phoneConfigRoutes({ settings }: { settings: SettingsStore }): Hono {
  const routes = new Hono();
  routes.get('/', async (c) => c.json<PhoneConfigDto>(await loadPhoneConfig(settings)));
  return routes;
}

export function phoneSettingsRoutes({ settings }: { settings: SettingsStore }): Hono {
  const routes = new Hono();

  const read = async (): Promise<PhoneSettingsDto> => ({
    ...(await loadPhoneConfig(settings)),
    defaults: { consentText: DEFAULT_PHONE_CONSENT_TEXT },
  });

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid phone settings' }, 400);
    await savePhoneConfig(settings, body.data);
    return c.json(await read());
  });

  return routes;
}
