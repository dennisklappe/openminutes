import type { Context } from 'hono';

export const redirectPath = (provider: string) => `/api/oauth/${provider}/callback`;

export function publicOrigin(c: Context, configured: string | undefined): string {
  if (configured) return configured.replace(/\/$/, '');
  const url = new URL(c.req.url);
  const protocol = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? url.host;
  return `${protocol}://${host}`;
}
