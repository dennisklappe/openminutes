import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  completeAuthorization,
  CALENDAR_WRITE_SCOPES,
  EXPORT_SCOPES,
  MissingCredentialsError,
  GMAIL_SEND_SCOPE,
  startAuthorization,
  type CalendarContext,
} from '@openminutes/calendar';
import { decryptSecret, encryptSecret } from '@openminutes/core';
import { calendarProviders, type CalendarProviderId } from '@openminutes/db';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { Hono, type Context } from 'hono';
import { publicOrigin, redirectPath } from './origin.js';

const COOKIE = 'openminutes_oauth';
const MAX_AGE_SECONDS = 600;

interface OAuthDeps {
  calendar: CalendarContext;
  secret: string;
  publicUrl: string | undefined;
}

interface Pending {
  provider: CalendarProviderId;
  nonce: string;
  verifier: string;
  gmail?: boolean;
  minutes?: boolean;
  expiresAt: number;
}

const parseProvider = (value: string): CalendarProviderId | undefined =>
  calendarProviders.find((provider) => provider === value);

const settingsPage = (query: string) => `/#/settings?${query}`;
const failure = (c: Context, message: string) =>
  c.redirect(settingsPage(new URLSearchParams({ error: message }).toString()));

function readPending(c: Context, secret: string): Pending | undefined {
  const cookie = getCookie(c, COOKIE);
  if (!cookie) return undefined;
  try {
    return JSON.parse(decryptSecret(cookie, secret)) as Pending;
  } catch {
    return undefined;
  }
}

function sameValue(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function oauthRoutes(deps: OAuthDeps): Hono {
  const routes = new Hono();

  routes.get('/:provider/start', async (c) => {
    const provider = parseProvider(c.req.param('provider'));
    if (!provider) return c.json({ error: 'Unknown provider' }, 404);
    const nonce = randomBytes(16).toString('base64url');
    const gmail = provider === 'google' && c.req.query('scope') === 'gmail';
    const documents = c.req.query('export') === '1';
    const calendarWrite = c.req.query('calendar') === 'write';
    try {
      const { url, codeVerifier } = await startAuthorization(deps.calendar, provider, {
        redirectUri: `${publicOrigin(c, deps.publicUrl)}${redirectPath(provider)}`,
        state: nonce,
        extraScopes: [
          ...(gmail ? [GMAIL_SEND_SCOPE] : []),
          ...(documents ? EXPORT_SCOPES[provider] : []),
          ...(calendarWrite ? CALENDAR_WRITE_SCOPES[provider] : []),
        ],
      });
      const pending: Pending = {
        provider,
        nonce,
        verifier: codeVerifier,
        ...(gmail && { gmail }),
        ...(calendarWrite && { minutes: calendarWrite }),
        expiresAt: Date.now() + MAX_AGE_SECONDS * 1000,
      };
      setCookie(c, COOKIE, encryptSecret(JSON.stringify(pending), deps.secret), {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/api/oauth',
        maxAge: MAX_AGE_SECONDS,
        secure: new URL(url).protocol === 'https:' && c.req.header('x-forwarded-proto') === 'https',
      });
      return c.redirect(url);
    } catch (error) {
      if (error instanceof MissingCredentialsError) return failure(c, error.message);
      throw error;
    }
  });

  routes.get('/:provider/callback', async (c) => {
    const provider = parseProvider(c.req.param('provider'));
    const pending = readPending(c, deps.secret);
    deleteCookie(c, COOKIE, { path: '/api/oauth' });
    const code = c.req.query('code');
    const state = c.req.query('state') ?? '';
    if (
      !provider ||
      !pending ||
      pending.provider !== provider ||
      pending.expiresAt < Date.now() ||
      !sameValue(pending.nonce, state)
    ) {
      return failure(c, 'The sign-in expired or did not start here, try connecting again');
    }
    if (!code) return failure(c, c.req.query('error_description') ?? 'Access was not granted');
    try {
      await completeAuthorization(deps.calendar, provider, {
        code,
        redirectUri: `${publicOrigin(c, deps.publicUrl)}${redirectPath(provider)}`,
        codeVerifier: pending.verifier,
      });
    } catch (error) {
      return failure(c, error instanceof Error ? error.message : 'Could not connect the account');
    }
    const query = new URLSearchParams({ connected: provider }).toString();
    if (pending.gmail) return c.redirect(`/#/settings/email?${query}`);
    return c.redirect(pending.minutes ? `/#/settings/minutes?${query}` : settingsPage(query));
  });

  return routes;
}
