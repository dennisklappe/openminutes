import type { MailAddress } from './types.js';

export function formatAddress({ name, address }: MailAddress): string {
  const label = name?.replace(/["\r\n<>]/g, '').trim();
  return label ? `${label} <${address}>` : address;
}
