import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { TokenSet } from './types.js';

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number(),
  scope: z.string().optional(),
});

export function parseTokens(
  body: unknown,
  previousRefreshToken?: string,
  now = Date.now(),
): TokenSet {
  const parsed = tokenResponse.parse(body);
  const refreshToken = parsed.refresh_token ?? previousRefreshToken;
  if (!refreshToken) throw new Error('The provider did not return a refresh token');
  return {
    accessToken: parsed.access_token,
    refreshToken,
    expiresAt: now + parsed.expires_in * 1000,
    ...(parsed.scope && { scope: parsed.scope }),
  };
}
