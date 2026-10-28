import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, apiKeys, eq, isNull, lt, or, type Database } from '@openminutes/db';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { clientKey } from './rate-limit.js';

export const API_KEY_PREFIX = 'omk_';
/** Requests per key per minute before a 429. */
export const DEFAULT_API_RATE_LIMIT = 600;
const LAST_USED_INTERVAL_MS = 60_000;
const RATE_WINDOW_MS = 60_000;
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 4;

/** Paths no key may use: key management, connected accounts and the sign-in routes. */
const KEY_FORBIDDEN = /^\/api\/(settings\/api-keys|accounts|oauth|setup|login|logout)(\/|$)/;

export const hashApiKey = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

export function generateApiKey(): { secret: string; hash: string; prefix: string } {
  const secret = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { secret, hash: hashApiKey(secret), prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH) };
}

export interface ApiKeyAuth {
  id: string;
  scope: 'read' | 'full';
}
export interface ApiKeyEnv {
  Variables: { apiKey?: ApiKeyAuth };
}

const bearerSecret = (c: Context): string | undefined => {
  const match = /^Bearer\s+(omk_\S+)$/i.exec(c.req.header('authorization') ?? '');
  return match?.[1];
};

/** True for an /api request that carries an API key, so Cloudflare Access is not asked for a login. */
export const isApiKeyRequest = (c: Context): boolean =>
  c.req.path.startsWith('/api/') && bearerSecret(c) !== undefined;

export const authenticatedKey = (c: Context): ApiKeyAuth | undefined =>
  (c as Context<ApiKeyEnv>).get('apiKey');

/** Fixed one minute window per key. */
export class ApiKeyRateLimiter {
  private readonly windows = new Map<string, { resetAt: number; count: number }>();

  constructor(
    private readonly limit = DEFAULT_API_RATE_LIMIT,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds to wait when the key is over its limit, else 0. */
  hit(key: string): number {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      for (const [id, old] of this.windows) if (old.resetAt <= now) this.windows.delete(id);
      window = { resetAt: now + RATE_WINDOW_MS, count: 0 };
      this.windows.set(key, window);
    }
    window.count += 1;
    return window.count > this.limit ? Math.ceil((window.resetAt - now) / 1000) : 0;
  }
}

const sameHash = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Accepts `Authorization: Bearer omk_...` on the /api routes. A request that carries a key is judged
 * on the key alone: the session cookie is never consulted and the cookie origin check is skipped.
 */
export function apiKeyAuth(deps: { db: Database; limiter: ApiKeyRateLimiter }) {
  return createMiddleware<ApiKeyEnv>(async (c, next) => {
    const presented = bearerSecret(c);
    if (presented === undefined) return next();
    const unauthorized = () => c.json({ error: 'Invalid API key' }, 401);
    const hash = hashApiKey(presented);
    const [key] = await deps.db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
    const now = new Date();
    if (
      !key ||
      !sameHash(key.keyHash, hash) ||
      key.revokedAt ||
      (key.expiresAt && key.expiresAt <= now)
    ) {
      return unauthorized();
    }
    const retryAfter = deps.limiter.hit(key.id);
    if (retryAfter > 0) {
      c.header('retry-after', String(retryAfter));
      return c.json({ error: 'Too many requests, slow down' }, 429);
    }
    if (KEY_FORBIDDEN.test(c.req.path)) {
      return c.json({ error: 'An API key cannot use this endpoint' }, 403);
    }
    if (key.scope === 'read' && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return c.json({ error: 'This API key is read only' }, 403);
    }
    if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() >= LAST_USED_INTERVAL_MS) {
      const stale = new Date(now.getTime() - LAST_USED_INTERVAL_MS);
      await deps.db
        .update(apiKeys)
        .set({ lastUsedAt: now, lastUsedIp: clientKey(c) })
        .where(
          and(
            eq(apiKeys.id, key.id),
            or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, stale)),
          ),
        );
    }
    c.set('apiKey', { id: key.id, scope: key.scope });
    return next();
  });
}
