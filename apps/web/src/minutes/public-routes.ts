import type { LocalStorage, SettingsStore } from '@openminutes/core';
import { and, eq, isNull, or, shareLinks, sql, type Database } from '@openminutes/db';
import { renderMinutesHtml, type ExporterRegistry } from '@openminutes/minutes';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { assembleMinutes } from './assemble.js';
import { loadLinks } from './links.js';
import { loadRenderOptions } from './config.js';
import { publicOrigin } from '../accounts/origin.js';
import { SHARE_SCRIPT_HASH, withShareTheme } from './share-theme.js';

interface PublicDeps {
  db: Database;
  exporters: ExporterRegistry;
  publicUrl?: string | undefined;
  settings: SettingsStore;
  storage: LocalStorage;
}

export const SHARE_PREFIX = '/s/';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UNAVAILABLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Not available</title><meta name="color-scheme" content="light dark"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1rem;color:#1c1f24;background:#fff}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#5d6572}@media(prefers-color-scheme:dark){body{color:#e6e8ec;background:#14171c}p{color:#9aa3b0}}</style></head><body><h1>This link is not available</h1><p>It may have expired or been withdrawn by its owner.</p></body></html>`;

const privateHeaders = createMiddleware(async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
  c.header('x-robots-tag', 'noindex, nofollow, noarchive');
  c.header('referrer-policy', 'no-referrer');
  c.header('x-content-type-options', 'nosniff');
  c.header(
    'content-security-policy',
    `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src '${SHARE_SCRIPT_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
});

export function publicShareRoutes(deps: PublicDeps): Hono {
  const routes = new Hono();
  routes.use('*', privateHeaders);

  routes.get('/:token', async (c) => {
    const token = c.req.param('token');
    if (!TOKEN.test(token)) return c.html(UNAVAILABLE, 404);
    const [share] = await deps.db
      .select()
      .from(shareLinks)
      .where(
        and(
          eq(shareLinks.token, token),
          isNull(shareLinks.revokedAt),
          or(isNull(shareLinks.expiresAt), sql`${shareLinks.expiresAt} > now()`),
        ),
      );
    const minutes = share && (await assembleMinutes(deps, share.meetingId));
    if (!share || !minutes) return c.html(UNAVAILABLE, 404);
    const options = await loadRenderOptions(deps.settings, deps.storage, {
      includeTranscript: share.includeTranscript,
      includeChat: share.includeChat,
      linksTab: share.includeLinks,
    });
    const origin = publicOrigin(c, deps.publicUrl);
    const own = { label: 'Shareable link', url: `${origin}/s/${token}` };
    const links = options.linksTab
      ? [
          own,
          ...(await loadLinks(deps.db, deps.exporters, share.meetingId, undefined)).filter(
            (link) => link.url !== own.url,
          ),
        ]
      : undefined;
    return c.html(withShareTheme(renderMinutesHtml(minutes, { ...options, links })));
  });

  routes.all('*', (c) => c.html(UNAVAILABLE, 404));
  return routes;
}
