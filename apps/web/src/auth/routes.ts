import { saveWizard, type SettingsStore } from '@openminutes/core';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { SessionDto } from '../dto.js';
import {
  ACCESS_COOKIE,
  ACCESS_HEADER,
  UNAUTHENTICATED_REDIRECT,
  type AccessVerifier,
} from './access.js';
import { hashPassword, verifyPassword } from './password.js';
import { clientKey, LoginRateLimiter } from './rate-limit.js';
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from './session.js';

interface AuthDeps {
  settings: SettingsStore;
  secret: string;
  access?: AccessVerifier;
  loginLimiter?: LoginRateLimiter;
}

const credentials = z.object({ password: z.string().min(1).max(256) });
const MIN_PASSWORD_LENGTH = 10;

async function isAuthenticated(deps: AuthDeps, token: string | undefined): Promise<boolean> {
  const hash = await deps.settings.get('admin.password_hash');
  return hash !== undefined && verifySessionToken(token, hash, deps.secret);
}

export const requireSession = (deps: AuthDeps) =>
  createMiddleware(async (c, next) => {
    if (deps.access) return next();
    if (!(await isAuthenticated(deps, getCookie(c, SESSION_COOKIE)))) {
      return c.json({ error: 'Not signed in' }, 401);
    }
    await next();
  });

const accessToken = (c: Context): string | undefined =>
  c.req.header(ACCESS_HEADER) ?? getCookie(c, ACCESS_COOKIE);

const PUBLIC_PATHS = new Set([
  '/api/version',
  '/login',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
]);

export const requireAccess = (access: AccessVerifier) =>
  createMiddleware(async (c, next) => {
    const { path } = c.req;
    if (PUBLIC_PATHS.has(path) || path.startsWith('/s/')) return next();
    if (!(await access.verify(accessToken(c)))) {
      if (path === '/' && c.req.method === 'GET') return c.redirect(UNAUTHENTICATED_REDIRECT, 302);
      return c.json({ error: 'Not signed in' }, 401);
    }
    await next();
  });

function accessRoutes(access: AccessVerifier): Hono {
  const routes = new Hono();
  routes.get('/session', async (c) =>
    c.json<SessionDto>({
      setupRequired: false,
      authenticated: true,
      email: await access.verify(accessToken(c)),
    }),
  );
  return routes;
}

export function authRoutes(deps: AuthDeps): Hono {
  if (deps.access) return accessRoutes(deps.access);
  const routes = new Hono();
  const limiter = deps.loginLimiter ?? new LoginRateLimiter();

  const startSession = (c: Parameters<typeof setCookie>[0], hash: string) => {
    setCookie(c, SESSION_COOKIE, createSessionToken(hash, deps.secret), {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: c.req.header('x-forwarded-proto') === 'https',
    });
  };

  routes.get('/session', async (c) => {
    const setupRequired = (await deps.settings.get('admin.password_hash')) === undefined;
    const authenticated = await isAuthenticated(deps, getCookie(c, SESSION_COOKIE));
    return c.json<SessionDto>({ setupRequired, authenticated });
  });

  routes.post('/setup', async (c) => {
    const body = credentials.safeParse(await c.req.json().catch(() => null));
    if (!body.success || body.data.password.length < MIN_PASSWORD_LENGTH) {
      return c.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
    }
    const hash = await hashPassword(body.data.password);
    if (!(await deps.settings.setIfAbsent('admin.password_hash', hash))) {
      return c.json({ error: 'Already set up' }, 409);
    }
    await saveWizard(deps.settings, { completed: false, step: 'transcription' });
    startSession(c, hash);
    return c.json({ ok: true }, 201);
  });

  routes.post('/login', async (c) => {
    const key = clientKey(c);
    const retryAfter = limiter.retryAfterSeconds(key);
    if (retryAfter > 0) {
      c.header('retry-after', String(retryAfter));
      return c.json(
        { error: `Too many failed attempts, try again in ${Math.ceil(retryAfter / 60)} min` },
        429,
      );
    }
    const body = credentials.safeParse(await c.req.json().catch(() => null));
    const hash = await deps.settings.get('admin.password_hash');
    if (!body.success || !hash || !(await verifyPassword(body.data.password, hash))) {
      limiter.recordFailure(key);
      return c.json({ error: 'Wrong password' }, 401);
    }
    limiter.reset(key);
    startSession(c, hash);
    return c.json({ ok: true });
  });

  routes.post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  return routes;
}
