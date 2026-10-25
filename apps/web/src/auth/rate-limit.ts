import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

const SWEEP_THRESHOLD = 1000;

export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  retryAfterSeconds(key: string): number {
    const recent = this.recent(key);
    const oldest = recent[0];
    if (recent.length < this.maxFailures || oldest === undefined) return 0;
    return Math.ceil((oldest + this.windowMs - this.now()) / 1000);
  }

  recordFailure(key: string): void {
    if (this.failures.size > SWEEP_THRESHOLD) {
      for (const stale of this.failures.keys()) this.recent(stale);
    }
    this.failures.set(key, [...this.recent(key), this.now()]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.failures.get(key) ?? []).filter((at) => at > cutoff);
    if (recent.length === 0) this.failures.delete(key);
    else this.failures.set(key, recent);
    return recent;
  }
}

export function clientKey(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
