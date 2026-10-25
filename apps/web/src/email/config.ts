import { DEFAULT_BODY, DEFAULT_SUBJECT, type MailAddress } from '@openminutes/mail';
import { loadProviderSettings, type SettingsStore } from '@openminutes/core';

export interface EmailConfig {
  provider: string;
  providerConfig: Record<string, unknown> | undefined;
  from: MailAddress | undefined;
  ownerAddress: string | undefined;
  subject: string;
  body: string;
}

export async function loadEmailConfig(settings: SettingsStore): Promise<EmailConfig> {
  const [{ provider, configs }, name, address, owner, subject, body] = await Promise.all([
    loadProviderSettings(settings, 'email'),
    settings.get('email.from_name'),
    settings.get('email.from_address'),
    settings.get('email.owner_address'),
    settings.get('email.subject'),
    settings.get('email.body'),
  ]);
  return {
    provider,
    providerConfig: configs[provider],
    from: address ? { address, ...(name && { name }) } : undefined,
    ownerAddress: owner || undefined,
    subject: subject || DEFAULT_SUBJECT,
    body: body || DEFAULT_BODY,
  };
}

/** True when a provider is saved and a from address is set, so mail can be sent. */
export const isReady = (config: EmailConfig) =>
  config.providerConfig !== undefined && config.from !== undefined;
