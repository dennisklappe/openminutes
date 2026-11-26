import {
  botAlertDue,
  botNotificationsEnabled,
  markBotAlertSent,
  type BotAccountProvider,
  type SettingsStore,
} from '@openminutes/core';
import { renderShareEmail, type MailDeps } from '@openminutes/mail';
import { loadMailer } from '../email/mailer.js';
import { SenderDomainError } from '../email/sender-domain.js';

const ALERT_TEXT: Record<BotAccountProvider, { subject: string; impact: string; hint: string }> = {
  google: {
    subject: 'The OpenMinutes bot needs to sign in to Google again',
    impact: 'Google Meet meetings can fail until this is fixed.',
    hint: 'Open Settings, Google Meet sign-in in OpenMinutes to sign the bot in again or to check its saved password.',
  },
  microsoft: {
    subject: 'The OpenMinutes bot needs to sign in to Microsoft again',
    impact: 'Microsoft Teams meetings can fail until this is fixed.',
    hint: 'Open Settings, Microsoft Teams sign-in in OpenMinutes and import a new session file, or remove the session so the bot joins Teams as a guest.',
  },
};

/**
 * Mails the owner that the bot's Google or Microsoft session needs attention, at most once per
 * day per provider. Does nothing when that provider's notifications are off or no mail provider
 * and owner address are set up.
 */
export async function sendSessionAlert(
  deps: { settings: SettingsStore; mailDeps: Partial<MailDeps>; now?: () => Date },
  reason: string,
  provider: BotAccountProvider = 'google',
): Promise<boolean> {
  const now = (deps.now ?? (() => new Date()))();
  if (
    !(await botNotificationsEnabled(provider, deps.settings)) ||
    !(await botAlertDue(provider, deps.settings, now))
  ) {
    return false;
  }
  const mailer = await loadMailer(deps.settings, deps.mailDeps).catch((error: unknown) => {
    if (error instanceof SenderDomainError) return undefined;
    throw error;
  });
  const owner = mailer?.config.ownerAddress;
  if (!mailer || !owner) return false;

  const { subject, impact, hint } = ALERT_TEXT[provider];
  const mail = renderShareEmail({
    subject,
    body: `${reason}.\n\n${impact} ${hint}`,
    title: '',
    date: '',
  });
  await mailer.provider.send({ from: mailer.from, to: [owner], ...mail });
  await markBotAlertSent(provider, deps.settings, now);
  return true;
}
