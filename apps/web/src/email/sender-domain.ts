import { z } from 'zod';
import type { EmailConfig } from './config.js';

export class SenderDomainError extends Error {}

/** The verified sending domain of the provider, for providers that need the from address on one. */
export function sendingDomain(config: Pick<EmailConfig, 'provider' | 'providerConfig'>) {
  const domain = config.providerConfig?.['domain'];
  return config.provider === 'emailit' && typeof domain === 'string'
    ? domain.trim().toLowerCase()
    : undefined;
}

/** Turns "minutes" into "minutes@domain" and checks the address is on the sending domain. */
export function resolveFromAddress(input: string, domain: string | undefined): string {
  const address = domain && input !== '' && !input.includes('@') ? `${input}@${domain}` : input;
  if (address === '') return address;
  if (!z.email().safeParse(address).success) {
    throw new SenderDomainError('Enter a valid from address');
  }
  if (domain && !address.toLowerCase().endsWith(`@${domain}`)) {
    throw new SenderDomainError(`The from address must be on ${domain}, the sending domain`);
  }
  return address;
}
