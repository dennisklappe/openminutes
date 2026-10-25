import {
  alertDue,
  markAlertSent,
  notificationsEnabled,
  type SettingsStore,
} from '@openminutes/core';
import { renderShareEmail, type MailDeps } from '@openminutes/mail';
import { loadMailer } from '../email/mailer.js';
import { SenderDomainError } from '../email/sender-domain.js';

const SETTINGS_HINT =
  'Open Settings, Google Meet sign-in in OpenMinutes to sign the bot in again or to check its saved password.';

/**
 * Mails the owner that the bot's Google session needs attention, at most once per day.
 * Does nothing when notifications are off or no mail provider and owner address are set up.
 */
export async function sendSessionAlert(
  deps: { settings: SettingsStore; mailDeps: Partial<MailDeps>; now?: () => Date },
  reason: string,
): Promise<boolean> {
  const now = (deps.now ?? (() => new Date()))();
  if (!(await notificationsEnabled(deps.settings)) || !(await alertDue(deps.settings, now))) {
    return false;
  }
  const mailer = await loadMailer(deps.settings, deps.mailDeps).catch((error: unknown) => {
    if (error instanceof SenderDomainError) return undefined;
    throw error;
  });
  const owner = mailer?.config.ownerAddress;
  if (!mailer || !owner) return false;

  const mail = renderShareEmail({
    subject: 'The OpenMinutes bot needs to sign in to Google again',
    body: `${reason}.\n\nGoogle Meet meetings can fail until this is fixed. ${SETTINGS_HINT}`,
    title: '',
    date: '',
  });
  await mailer.provider.send({ from: mailer.from, to: [owner], ...mail });
  await markAlertSent(deps.settings, now);
  return true;
}
