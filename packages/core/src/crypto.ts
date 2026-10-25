import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const VERSION = 'v1';
const keyCache = new Map<string, Buffer>();

function deriveKey(secret: string): Buffer {
  let key = keyCache.get(secret);
  if (!key) {
    // The salt keeps the name the project had before the rename: changing it would make every
    // stored credential of an existing install undecryptable.
    key = scryptSync(secret, 'minutd-secrets-v1', 32);
    keyCache.set(secret, key);
  }
  return key;
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), body].map((p) => p.toString('base64'));
  return [VERSION, ...parts].join(':');
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, iv, tag, body] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !body) {
    throw new Error('Unsupported encrypted payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
