import type { FetchLike, TestResult } from '@openminutes/providers';

export interface MailAddress {
  name?: string | undefined;
  address: string;
}

export interface MailMessage {
  from: MailAddress;
  to: string[];
  replyTo?: string | undefined;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  id?: string;
}

export interface MailProvider {
  send(message: MailMessage): Promise<SendResult>;
  /** Checks the configuration without sending any mail. */
  test(): Promise<TestResult>;
}

export interface MailDeps {
  fetch: FetchLike;
  /**
   * Returns a Google access token with the Gmail send scope for the connected
   * account, or throws a ProviderError when none is connected.
   */
  googleToken?: (account: string | undefined) => Promise<string>;
}
