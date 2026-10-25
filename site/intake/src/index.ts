/**
 * The only server openminut.es has: it turns the hosting form into a Balie ticket.
 *
 * POST /  JSON {name, email, tier, notes, website, turnstile}
 *
 * The site is static and cannot hold the Balie server key, so this Worker does.
 * Secrets: BALIE_API_KEY (the openminutes company server key), TURNSTILE_SECRET.
 * Route: api.openminut.es (see wrangler.jsonc).
 */
import { parseRequest, ticketMessage, ticketSubject } from './request.js';

interface Env {
  BALIE_API_KEY: string;
  TURNSTILE_SECRET?: string;
  LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const MAX_BODY = 16 * 1024;

const ORIGINS = new Set(['https://openminut.es', 'https://www.openminut.es']);
const BALIE = 'https://app.balie.net/api/v1/tickets';
const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function reply(body: unknown, status: number, origin: string | null): Response {
  const allowed = origin && ORIGINS.has(origin) ? origin : 'https://openminut.es';
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    },
  });
}

async function passesTurnstile(env: Env, token: unknown, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return false;
  if (typeof token !== 'string' || !token) return false;
  const res = await fetch(TURNSTILE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const result = await res.json<{ success?: boolean }>();
  return result.success === true;
}

type Failure = { error: string; status: number };

async function createTicket(env: Env, payload: Record<string, unknown>): Promise<Failure | null> {
  const parsed = parseRequest(payload);
  if (parsed.kind === 'bot') return null;
  if (parsed.kind === 'invalid') return { error: parsed.error, status: 400 };
  const { request } = parsed;
  const res = await fetch(BALIE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.BALIE_API_KEY}` },
    body: JSON.stringify({
      email: request.email,
      name: request.name || undefined,
      subject: ticketSubject(request),
      message: ticketMessage(request),
      form: 'hosting',
      metadata: { tier: request.tier },
    }),
  });
  if (!res.ok) console.error('balie rejected the ticket', res.status);
  return res.ok ? null : { error: 'upstream_failed', status: 502 };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405, origin);
    if (!origin || !ORIGINS.has(origin)) return reply({ error: 'forbidden_origin' }, 403, origin);

    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip || 'unknown' })).success) {
      return reply({ error: 'rate_limited' }, 429, origin);
    }

    if (Number(request.headers.get('Content-Length')) > MAX_BODY) {
      return reply({ error: 'too_large' }, 413, origin);
    }

    let payload: Record<string, unknown>;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return reply({ error: 'too_large' }, 413, origin);
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('shape');
      payload = parsed as Record<string, unknown>;
    } catch {
      return reply({ error: 'invalid_json' }, 400, origin);
    }

    if (!(await passesTurnstile(env, payload.turnstile, ip))) {
      return reply({ error: 'challenge_failed' }, 403, origin);
    }

    const failure = await createTicket(env, payload);
    if (failure) return reply({ error: failure.error }, failure.status, origin);
    return reply({ ok: true }, 200, origin);
  },
};
