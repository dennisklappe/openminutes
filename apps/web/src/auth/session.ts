import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'openminutes_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function sign(expiresAt: number, passwordHash: string, secret: string): string {
  return createHmac('sha256', secret).update(`${expiresAt}.${passwordHash}`).digest('base64url');
}

export function createSessionToken(passwordHash: string, secret: string, now = Date.now()): string {
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  return `${expiresAt}.${sign(expiresAt, passwordHash, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  passwordHash: string,
  secret: string,
  now = Date.now(),
): boolean {
  const [expires, signature] = token?.split('.') ?? [];
  const expiresAt = Number(expires);
  if (!signature || !Number.isFinite(expiresAt) || expiresAt < now) return false;
  const expected = Buffer.from(sign(expiresAt, passwordHash, secret));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
