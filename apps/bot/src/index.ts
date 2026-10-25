import { JobQueue, MAX_CONCURRENT_MEETINGS, LocalStorage, SettingsStore } from '@openminutes/core';
import { createDatabase, migrateOnStartup } from '@openminutes/db';
import { loadBotEnv } from './env.js';
import { runGoogleKeepAlive } from './google-keepalive.js';
import { launchHeadless } from './google-browser.js';
import { runMeeting } from './session.js';
import { registerOpenSegments } from './recovery.js';
import { failInterruptedMeetings } from './slots.js';

const KEEPALIVE_CRON = '41 4 * * *';

const env = loadBotEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);
await migrateOnStartup(pool);

const queue = await JobQueue.start(env.DATABASE_URL);
const deps = {
  db,
  queue,
  env,
  settings: new SettingsStore(db, env.OPENMINUTES_SECRET),
  storage: new LocalStorage(env.OPENMINUTES_DATA_DIR),
};

const interrupted = await failInterruptedMeetings(db);
if (interrupted.length > 0) {
  const recovered = await registerOpenSegments(db, env.OPENMINUTES_DATA_DIR, interrupted);
  console.log(
    `marked ${interrupted.length} interrupted meetings as failed, recovered ${recovered} audio files`,
  );
}

await queue.work('meeting.join', (payload) => runMeeting(deps, payload), {
  concurrency: MAX_CONCURRENT_MEETINGS,
});
await queue.work('bot.google-keepalive', () =>
  runGoogleKeepAlive({ settings: deps.settings, queue, launch: launchHeadless(env) }),
);
await queue.schedule('bot.google-keepalive', KEEPALIVE_CRON, {});
console.log('bot ready');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void queue.stop().then(() => pool.end());
  });
}
