import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function decodeBase32(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('The authenticator secret is not valid base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}

export const isValidTotpSecret = (text: string) => {
  try {
    return decodeBase32(text).length >= 10;
  } catch {
    return false;
  }
};

/** RFC 6238 code (HMAC-SHA1, 30 second steps, 6 digits) for a base32 secret. */
export function totp(secret: string, now: Date = new Date()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 1000 / STEP_SECONDS)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const code = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}
