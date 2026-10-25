import type { SettingsStore } from '@openminutes/core';
import {
  createMailProvider,
  type MailAddress,
  type MailDeps,
  type MailProvider,
} from '@openminutes/mail';
import { ProviderError } from '@openminutes/providers';
import { GmailAccessError, gmailAccessToken, type CalendarContext } from '@openminutes/calendar';
import { isReady, loadEmailConfig, type EmailConfig } from './config.js';
import { resolveFromAddress, sendingDomain } from './sender-domain.js';

export interface Mailer {
  provider: MailProvider;
  from: MailAddress;
  config: EmailConfig;
}

export function googleMailDeps(calendar: CalendarContext): Pick<MailDeps, 'googleToken'> {
  return {
    googleToken: async (account) => {
      try {
        return await gmailAccessToken(calendar, account);
      } catch (error) {
        if (error instanceof GmailAccessError) {
          throw new ProviderError('gmail', 'auth', error.message);
        }
        throw error;
      }
    },
  };
}

export async function loadMailer(
  settings: SettingsStore,
  deps: Partial<MailDeps>,
): Promise<Mailer | undefined> {
  const config = await loadEmailConfig(settings);
  if (!isReady(config) || !config.from) return undefined;
  resolveFromAddress(config.from.address, sendingDomain(config));
  return {
    provider: createMailProvider(config.provider, config.providerConfig, deps),
    from: config.from,
    config,
  };
}
