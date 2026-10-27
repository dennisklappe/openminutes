import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { serve } from '@hono/node-server';
import { calendarEnvSchema, createProviders, endpointsFor } from '@openminutes/calendar';
import {
  backfillPeople,
  baseEnvSchema,
  JobQueue,
  LocalStorage,
  parseEnv,
  SettingsStore,
} from '@openminutes/core';
import { createDatabase, migrateOnStartup } from '@openminutes/db';
import { z } from 'zod';
import { createApp } from './app.js';
import { DEFAULT_IMPORT_MAX_GB } from './imports/config.js';
import { googleMailDeps } from './email/mailer.js';
import { sendSessionAlert } from './settings/session-alert.js';
import { runCalendarLink } from './minutes/calendar-link.js';
import { runAutoExport } from './minutes/auto-export.js';
import { createWebExporters } from './minutes/exporters.js';
import { accessConfigFromEnv, accessEnvSchema, AccessVerifier } from './auth/access.js';
import { readVersion } from './version.js';

const env = parseEnv(
  baseEnvSchema.extend({
    ...calendarEnvSchema.shape,
    ...accessEnvSchema.shape,
    PORT: z.coerce.number().int().default(3000),
    OPENMINUTES_IMPORT_MAX_GB: z.coerce.number().positive().default(DEFAULT_IMPORT_MAX_GB),
    OPENMINUTES_PUBLIC_URL: z.union([z.url(), z.literal('')]).optional(),
  }),
);
const accessConfig = accessConfigFromEnv(env);
const { db, pool } = createDatabase(env.DATABASE_URL);
await migrateOnStartup(pool);
const queue = await JobQueue.start(env.DATABASE_URL);

const settings = new SettingsStore(db, env.OPENMINUTES_SECRET);
// Once, in the background: give everyone from the existing meetings a profile. The People page can run it again.
void (async () => {
  if ((await settings.get('people.backfilled')) === 'true') return;
  await backfillPeople(db);
  await settings.set('people.backfilled', 'true');
})().catch((error: unknown) => {
  console.error('people backfill failed, it runs again on the next start', error);
});
const storage = new LocalStorage(env.OPENMINUTES_DATA_DIR);
const publicUrl = env.OPENMINUTES_PUBLIC_URL || undefined;
const calendarProviders = createProviders({ fakeBaseUrl: env.OPENMINUTES_FAKE_CALENDAR_URL });
const endpoints = endpointsFor(env.OPENMINUTES_FAKE_CALENDAR_URL);
const calendar = {
  db,
  queue,
  settings,
  providers: calendarProviders,
  secret: env.OPENMINUTES_SECRET,
};
const exporters = createWebExporters({
  calendar,
  endpoints,
  publicUrl,
});
await queue.work('meeting.export', ({ meetingId }) =>
  runAutoExport({ db, settings, storage, exporters, publicUrl }, meetingId),
);
await queue.work('meeting.calendar-link', ({ meetingId, force }) =>
  runCalendarLink({ calendar, publicUrl }, meetingId, force),
);

await queue.work('bot.session-alert', async ({ reason }) => {
  await sendSessionAlert({ settings, mailDeps: googleMailDeps(calendar) }, reason);
});

const app = createApp({
  db,
  queue,
  settings,
  storage,
  exporters,
  endpoints,
  secret: env.OPENMINUTES_SECRET,
  calendarProviders,
  importMaxBytes: Math.floor(env.OPENMINUTES_IMPORT_MAX_GB * 1024 ** 3),
  ...(publicUrl && { publicUrl }),
  ...(accessConfig && { access: new AccessVerifier(accessConfig) }),
  version: readVersion(),
  uiRoot: relative(process.cwd(), fileURLToPath(new URL('./ui', import.meta.url))),
});

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`web listening on ${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void queue.stop().then(() => pool.end());
  });
}
