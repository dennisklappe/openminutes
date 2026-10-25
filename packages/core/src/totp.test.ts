import { describe, expect, it } from 'vitest';
import { isValidTotpSecret, totp } from './totp.js';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 vector at %s', (seconds, code) => {
    expect(totp(RFC_SECRET, new Date(seconds * 1000))).toBe(code);
  });

  it('ignores spaces and case in the secret', () => {
    expect(totp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', new Date(59_000))).toBe('287082');
  });

  it('validates secrets', () => {
    expect(isValidTotpSecret(RFC_SECRET)).toBe(true);
    expect(isValidTotpSecret('not base32!')).toBe(false);
    expect(isValidTotpSecret('ABC')).toBe(false);
  });
});
