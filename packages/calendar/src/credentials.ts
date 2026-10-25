import type { SettingsStore } from '@openminutes/core';
import type { CalendarProviderId } from '@openminutes/db';
import type { Credentials } from './types.js';

export async function loadCredentials(
  settings: SettingsStore,
  provider: CalendarProviderId,
): Promise<Credentials | undefined> {
  const [clientId, clientSecret] = await Promise.all([
    settings.get(`${provider}.client_id`),
    settings.get(`${provider}.client_secret`),
  ]);
  if (!clientId || !clientSecret) return undefined;
  const tenant = provider === 'microsoft' ? await settings.get('microsoft.tenant') : undefined;
  return { clientId, clientSecret, tenant };
}
