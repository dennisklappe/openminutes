export { formatAddress } from './address.js';
export { defineMailProvider, type MailProviderDefinition } from './define.js';
export { createMailProvider, mailProviders } from './registry.js';
export {
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  PLACEHOLDERS,
  POWERED_BY,
  renderShareEmail,
  type Placeholder,
  type ShareEmail,
  type ShareEmailInput,
  type ShareItem,
} from './share-email.js';
export type { MailAddress, MailDeps, MailMessage, MailProvider, SendResult } from './types.js';
