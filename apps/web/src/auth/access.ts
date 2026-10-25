import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';

export const ACCESS_HEADER = 'cf-access-jwt-assertion';
export const ACCESS_COOKIE = 'CF_Authorization';
export const UNAUTHENTICATED_REDIRECT = 'https://github.com/dennisklappe/openminutes';
const REFRESH_COOLDOWN_MS = 60_000;

export const accessEnvSchema = z.object({
  OPENMINUTES_AUTH: z.enum(['password', 'cloudflare-access']).default('password'),
  OPENMINUTES_ACCESS_TEAM_DOMAIN: z.string().optional(),
  OPENMINUTES_ACCESS_AUD: z.string().optional(),
  OPENMINUTES_ACCESS_EMAILS: z.string().optional(),
});

export interface AccessConfig {
  teamDomain: string;
  audience: string;
  emails?: string[];
  certsUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export function accessConfigFromEnv(
  env: z.infer<typeof accessEnvSchema>,
): AccessConfig | undefined {
  if (env.OPENMINUTES_AUTH === 'password') return undefined;
  const teamDomain = env.OPENMINUTES_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.OPENMINUTES_ACCESS_AUD?.trim();
  if (!teamDomain || !audience) {
    throw new Error(
      'OPENMINUTES_AUTH=cloudflare-access needs OPENMINUTES_ACCESS_TEAM_DOMAIN and OPENMINUTES_ACCESS_AUD',
    );
  }
  const emails = (env.OPENMINUTES_ACCESS_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return { teamDomain, audience, ...(emails.length > 0 && { emails }) };
}

const jwtHeader = z.object({ alg: z.literal('RS256'), kid: z.string() });
const jwtClaims = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  nbf: z.number().optional(),
  email: z.string().optional(),
});
const jwks = z.object({ keys: z.array(z.object({ kid: z.string() }).loose()) });

const decode = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString());

export class AccessVerifier {
  private keys = new Map<string, KeyObject>();
  private lastRefresh = Number.NEGATIVE_INFINITY;
  private readonly certsUrl: string;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly config: AccessConfig) {
    this.certsUrl = config.certsUrl ?? `https://${config.teamDomain}/cdn-cgi/access/certs`;
    this.fetch = config.fetch ?? fetch;
    this.now = config.now ?? Date.now;
  }

  /** Returns the verified email of the Access user, or undefined for anything that fails a check. */
  async verify(token: string | undefined): Promise<string | undefined> {
    const parts = token?.split('.');
    if (parts?.length !== 3) return undefined;
    const [header, payload, signature] = parts as [string, string, string];
    try {
      const { kid } = jwtHeader.parse(decode(header));
      const key = await this.keyFor(kid);
      const signed = Buffer.from(`${header}.${payload}`);
      if (!key || !verify('RSA-SHA256', signed, key, Buffer.from(signature, 'base64url'))) {
        return undefined;
      }
      return this.checkClaims(jwtClaims.parse(decode(payload)));
    } catch {
      return undefined;
    }
  }

  private checkClaims(claims: z.infer<typeof jwtClaims>): string | undefined {
    const nowSeconds = this.now() / 1000;
    const audiences = [claims.aud].flat();
    const email = claims.email?.toLowerCase();
    if (
      claims.iss !== `https://${this.config.teamDomain}` ||
      !audiences.includes(this.config.audience) ||
      claims.exp <= nowSeconds ||
      (claims.nbf !== undefined && claims.nbf > nowSeconds) ||
      !email ||
      (this.config.emails && !this.config.emails.includes(email))
    ) {
      return undefined;
    }
    return email;
  }

  private async keyFor(kid: string): Promise<KeyObject | undefined> {
    if (!this.keys.has(kid) && this.now() - this.lastRefresh >= REFRESH_COOLDOWN_MS) {
      await this.refresh();
    }
    return this.keys.get(kid);
  }

  private async refresh(): Promise<void> {
    this.lastRefresh = this.now();
    const response = await this.fetch(this.certsUrl);
    if (!response.ok) throw new Error(`Access certs request failed: ${response.status}`);
    const { keys } = jwks.parse(await response.json());
    this.keys = new Map(
      keys.map((jwk) => [jwk.kid, createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' })]),
    );
  }
}
