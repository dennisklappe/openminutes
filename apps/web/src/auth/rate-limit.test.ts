import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from './rate-limit.js';

describe('LoginRateLimiter', () => {
  it('blocks a key after too many failures until the window passes', () => {
    let now = 0;
    const limiter = new LoginRateLimiter(3, 60_000, () => now);

    for (let i = 0; i < 3; i++) {
      expect(limiter.retryAfterSeconds('a')).toBe(0);
      limiter.recordFailure('a');
      now += 1000;
    }
    expect(limiter.retryAfterSeconds('a')).toBe(57);
    expect(limiter.retryAfterSeconds('b')).toBe(0);

    now += 57_000;
    expect(limiter.retryAfterSeconds('a')).toBe(0);
  });

  it('forgets failures after a successful login', () => {
    const limiter = new LoginRateLimiter(1, 60_000, () => 0);
    limiter.recordFailure('a');
    expect(limiter.retryAfterSeconds('a')).toBe(60);
    limiter.reset('a');
    expect(limiter.retryAfterSeconds('a')).toBe(0);
  });
});
