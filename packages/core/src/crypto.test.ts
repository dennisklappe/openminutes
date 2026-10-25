import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';

const secret = 'a-long-enough-test-secret';

describe('secret encryption', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const a = encryptSecret('hunter2', secret);
    const b = encryptSecret('hunter2', secret);
    expect(a).not.toBe(b);
    expect(a).not.toContain('hunter2');
    expect(decryptSecret(a, secret)).toBe('hunter2');
  });

  it('rejects a wrong key and tampered data', () => {
    const payload = encryptSecret('hunter2', secret);
    expect(() => decryptSecret(payload, 'another-long-enough-secret')).toThrow();
    const [v, iv, tag] = payload.split(':');
    const flipped = `${v}:${iv}:${tag}:${Buffer.from('xx').toString('base64')}`;
    expect(() => decryptSecret(flipped, secret)).toThrow();
  });

  it('rejects unknown formats', () => {
    expect(() => decryptSecret('v9:a:b:c', secret)).toThrow('Unsupported');
  });
});
