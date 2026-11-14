import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SECRET_PREFIX = 'whsec_';
/** How much of the secret is stored in the clear, enough to recognise it. */
export const WEBHOOK_SECRET_DISPLAY_LENGTH = 10;
/** Receivers reject a signature older or newer than this. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function generateWebhookSecret(): { secret: string; prefix: string } {
  const secret = `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { secret, prefix: secret.slice(0, WEBHOOK_SECRET_DISPLAY_LENGTH) };
}

const hmac = (secret: string, timestamp: number, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/** The `X-OpenMinutes-Signature` header: `t=<unix seconds>,v1=<hex hmac-sha256 of "t.body">`. */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, body)}`;
}

export interface VerifyOptions {
  /** Unix seconds, defaults to now. */
  now?: number;
  toleranceSeconds?: number;
}

/**
 * Checks a signature header against the raw request body the way a receiver should: the
 * timestamp must be within the tolerance and one of the `v1` values must match.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  options: VerifyOptions = {},
): boolean {
  const parts = header.split(',').map((part) => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  if (!Number.isInteger(timestamp)) return false;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) {
    return false;
  }
  const expected = Buffer.from(hmac(secret, timestamp, body), 'hex');
  return parts.some(([key, value]) => {
    if (key !== 'v1' || !value || !/^[0-9a-f]+$/i.test(value)) return false;
    const given = Buffer.from(value, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
