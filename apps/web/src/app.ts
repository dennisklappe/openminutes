import { endpointsFor, type CalendarProviders, type Endpoints } from '@openminutes/calendar';
import type { JobSender, LocalStorage, SettingsStore } from '@openminutes/core';
import type { Deps } from '@openminutes/providers';
import type { Database } from '@openminutes/db';
import type { ExporterRegistry } from '@openminutes/minutes';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { createMiddleware } from 'hono/factory';
import { securityHeaders } from './security-headers.js';
import { accountRoutes } from './accounts/routes.js';
import { oauthRoutes } from './accounts/oauth.js';
import { apiKeyAuth, ApiKeyRateLimiter, authenticatedKey } from './auth/api-keys.js';
import { authRoutes, requireAccess, requireSession } from './auth/routes.js';
import type { AccessVerifier } from './auth/access.js';
import type { LoginRateLimiter } from './auth/rate-limit.js';
import { importRoutes } from './imports/routes.js';
import { DEFAULT_IMPORT_MAX_GB } from './imports/config.js';
import { libraryRoutes } from './library/routes.js';
import { binRoutes } from './meetings/bin-routes.js';
import { meetingRoutes } from './meetings/routes.js';
import { titleRoutes } from './meetings/title-routes.js';
import { checkPeopleRoutes } from './meetings/check-people-routes.js';
import { roomRoutes } from './meetings/room-routes.js';
import { speakerEditRoutes } from './meetings/speaker-edit-routes.js';
import { seriesRoutes } from './meetings/series-routes.js';
import { exportRoutes, exporterListRoutes } from './minutes/export-routes.js';
import { calendarLinkActionRoutes } from './minutes/calendar-link-routes.js';
import { exportSettingsRoutes } from './minutes/export-settings-routes.js';
import { createWebExporters } from './minutes/exporters.js';
import { publicShareRoutes, SHARE_PREFIX } from './minutes/public-routes.js';
import { emailSettingsRoutes } from './email/settings-routes.js';
import { googleMailDeps } from './email/mailer.js';
import { shareEmailRoutes } from './email/share-routes.js';
import { minutesSettingsRoutes } from './minutes/settings-routes.js';
import { shareRoutes } from './minutes/share-routes.js';
import { recordingRoutes } from './recordings/routes.js';
import { phoneConfigRoutes, phoneSettingsRoutes } from './settings/phone.js';
import { summaryAiEditRoutes } from './minutes/ai-edit-routes.js';
import { summaryEditRoutes } from './minutes/summary-edit-routes.js';
import { promptRoutes } from './settings/prompts.js';
import { providerSettingsRoutes } from './settings/providers.js';
import { apiKeySettingsRoutes } from './settings/api-keys.js';
import { botRoutes } from './settings/bot.js';
import { googleSessionRoutes } from './settings/google-session.js';
import { limitsRoutes } from './settings/limits.js';
import { timeZoneRoutes } from './settings/timezone.js';
import { speakerSettingsRoutes } from './settings/speakers.js';
import { sharedAccountsSettingsRoutes } from './settings/shared-accounts.js';
import { summaryChatSettingsRoutes } from './settings/summary-chat.js';
import { storageRoutes } from './settings/storage.js';
import { wizardRoutes } from './settings/wizard.js';
import { participantAliasRoutes } from './participants/alias-routes.js';
import { meetingParticipantRoutes } from './participants/routes.js';
import { peopleRoutes } from './people/routes.js';
import { meetingVoiceRoutes } from './voices/routes.js';
import { voiceSettingsRoutes } from './voices/settings-routes.js';
import { UpdateChecker } from './updates/checker.js';
import { updateRoutes } from './updates/routes.js';

export interface AppDeps {
  db: Database;
  queue: JobSender;
  settings: SettingsStore;
  storage: LocalStorage;
  secret: string;
  providerDeps?: Partial<Deps>;
  calendarProviders: CalendarProviders;
  publicUrl?: string;
  version: string;
  updateFetch?: typeof fetch;
  access?: AccessVerifier;
  loginLimiter?: LoginRateLimiter;
  uiRoot?: string;
  exporters?: ExporterRegistry;
  endpoints?: Endpoints;
  importMaxBytes?: number;
  /** Requests per minute per API key, see DEFAULT_API_RATE_LIMIT. */
  apiRateLimit?: number;
}

/** Every JSON body is far smaller than this. Uploads that need more set their own limit. */
export const MAX_API_BODY_BYTES = 4 * 1024 * 1024;
const GIB = 1024 * 1024 * 1024;
const CHUNK_UPLOAD = /^\/api\/(recordings|imports)\/[^/]+\/chunks\//;
const limitBody = bodyLimit({
  maxSize: MAX_API_BODY_BYTES,
  onError: (c) => c.json({ error: 'The request is too large' }, 413),
});
const limitApiBody = createMiddleware((c, next) =>
  CHUNK_UPLOAD.test(c.req.path) ? next() : limitBody(c, next),
);

const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Page not found</title><meta name="color-scheme" content="light dark"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1rem;color:#1c1f24;background:#fff}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0 0 1rem;color:#5d6572}a{color:#2760ab;display:inline-block;padding:.6rem 0}@media(prefers-color-scheme:dark){body{color:#e6e8ec;background:#14171c}p{color:#9aa3b0}a{color:#74a8ef}}</style></head><body><h1>Page not found</h1><p>Nothing lives at this address.</p><a href="/">Back to OpenMinutes</a></body></html>`;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const api = new Hono();
  const calendar = {
    db: deps.db,
    queue: deps.queue,
    settings: deps.settings,
    providers: deps.calendarProviders,
    secret: deps.secret,
  };
  const updates = new UpdateChecker({
    settings: deps.settings,
    version: deps.version,
    ...(deps.updateFetch && { fetch: deps.updateFetch }),
  });
  const exporters =
    deps.exporters ??
    createWebExporters({
      calendar,
      endpoints: deps.endpoints ?? endpointsFor(),
      publicUrl: deps.publicUrl,
    });
  const mailDeps = {
    ...(deps.providerDeps?.fetch && { fetch: deps.providerDeps.fetch }),
    ...googleMailDeps(calendar),
  };
  const accountDeps = { calendar, publicUrl: deps.publicUrl };

  app.use('*', securityHeaders);
  if (deps.access) app.use('*', requireAccess(deps.access));
  app.get('/login', (c) => c.redirect('/', 302));
  api.use('*', limitApiBody);
  api.use(apiKeyAuth({ db: deps.db, limiter: new ApiKeyRateLimiter(deps.apiRateLimit) }));
  const cookieCsrf = csrf();
  api.use(createMiddleware((c, next) => (authenticatedKey(c) ? next() : cookieCsrf(c, next))));
  api.get('/version', (c) => c.json({ version: deps.version }));
  api.route('/', authRoutes(deps));
  api.use('/meetings/*', requireSession(deps));
  api.route('/meetings', meetingRoutes(deps));
  api.route('/meetings', binRoutes(deps));
  api.route('/meetings', titleRoutes(deps));
  api.route('/meetings', meetingVoiceRoutes(deps));
  api.route('/meetings', meetingParticipantRoutes(deps));
  api.route('/meetings', speakerEditRoutes(deps));
  api.route('/meetings', roomRoutes(deps));
  api.route('/meetings', checkPeopleRoutes(deps));
  api.use('/people/*', requireSession(deps));
  api.route('/people', peopleRoutes(deps));
  api.use('/series/*', requireSession(deps));
  api.route('/series', seriesRoutes(deps));
  api.route('/meetings', shareRoutes(deps));
  api.route('/meetings', summaryEditRoutes(deps));
  api.route('/meetings', summaryAiEditRoutes(deps));
  api.route('/meetings', exportRoutes({ ...deps, exporters }));
  api.route('/meetings', calendarLinkActionRoutes(deps));
  api.route('/meetings', shareEmailRoutes({ ...deps, exporters, mailDeps }));
  api.use('/library/*', requireSession(deps));
  api.route('/library', libraryRoutes(deps));
  api.use('/recordings/*', requireSession(deps));
  api.route('/recordings', recordingRoutes(deps));
  api.use('/imports/*', requireSession(deps));
  api.route(
    '/imports',
    importRoutes({ ...deps, importMaxBytes: deps.importMaxBytes ?? DEFAULT_IMPORT_MAX_GB * GIB }),
  );
  api.use('/phone', requireSession(deps));
  api.route('/phone', phoneConfigRoutes(deps));
  api.use('/exporters', requireSession(deps));
  api.route('/exporters', exporterListRoutes(exporters, deps.settings));
  api.use('/settings/*', requireSession(deps));
  api.use('/accounts/*', requireSession(deps));
  api.route('/accounts', accountRoutes(accountDeps));
  api.use('/oauth/:provider/start', requireSession(deps));
  api.route('/oauth', oauthRoutes({ ...accountDeps, secret: deps.secret }));
  api.route('/settings/api-keys', apiKeySettingsRoutes(deps));
  api.route('/settings/transcription', providerSettingsRoutes('transcription', deps));
  api.route('/settings/summary', providerSettingsRoutes('summary', deps));
  api.route('/settings/prompts', promptRoutes(deps));
  api.route('/settings/storage', storageRoutes(deps));
  api.route('/settings/limits', limitsRoutes(deps));
  api.route('/settings/timezone', timeZoneRoutes(deps));
  api.route('/settings/phone', phoneSettingsRoutes(deps));
  api.route('/settings/speakers', speakerSettingsRoutes(deps));
  api.route('/settings/summary-chat', summaryChatSettingsRoutes(deps));
  api.route('/settings/shared-accounts', sharedAccountsSettingsRoutes(deps));
  api.route('/settings/voices', voiceSettingsRoutes(deps));
  api.route('/settings/participant-aliases', participantAliasRoutes(deps));
  api.route('/settings/wizard', wizardRoutes(deps));
  api.route('/settings/minutes/export', exportSettingsRoutes({ ...deps, exporters }));
  api.route('/settings/minutes', minutesSettingsRoutes({ ...deps, exporters }));
  api.route('/settings/email/provider', providerSettingsRoutes('email', { ...deps, mailDeps }));
  api.route('/settings/email', emailSettingsRoutes({ ...deps, calendar, mailDeps }));
  api.route('/settings', botRoutes(deps));
  api.route('/settings', googleSessionRoutes(deps));
  api.route('/settings/updates', updateRoutes({ settings: deps.settings, updates }));
  api.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.route('/api', api);
  app.route(SHARE_PREFIX.slice(0, -1), publicShareRoutes({ ...deps, exporters }));
  if (deps.uiRoot) {
    app.get('/sw.js', async (c, next) => {
      c.header('Cache-Control', 'no-cache');
      await next();
    });
    app.get('*', serveStatic({ root: deps.uiRoot }));
  }
  app.notFound((c) =>
    c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.html(NOT_FOUND, 404),
  );
  return app;
}
