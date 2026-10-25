import { calendarEnvSchema, createProviders, syncAccounts } from '@openminutes/calendar';
import {
  baseEnvSchema,
  createConfiguredSummarizer,
  createConfiguredTranscriber,
  failStuckMeetings,
  JobQueue,
  loadAudioStorage,
  LocalStorage,
  parseEnv,
  purgeExpiredBin,
  requestSummary,
  SettingsStore,
  SummaryNotConfiguredError,
} from '@openminutes/core';
import { createDatabase, migrateOnStartup } from '@openminutes/db';
import { createLocalDiarizer } from '@openminutes/providers';
import { createFallbackTranscriber, createLanguageDetection } from './local-whisper.js';
import { longFetch } from './long-fetch.js';
import { mergeAudio } from './merge-audio.js';
import { detectSilence } from './detect-silence.js';
import { trimAudio } from './trim-audio.js';
import { processMeeting } from './process.js';
import { learnVoice } from './learn-voice.js';
import { createRecordingDeps } from './recording-deps.js';
import { deleteExpiredAudio } from './retention.js';
import { scheduleMeeting } from './schedule.js';
import { reviewMeetingSpeakers } from './speaker-review/job.js';
import { runSummary } from './summary-job.js';

const SYNC_CRON = '*/2 * * * *';
const RETENTION_CRON = '17 3 * * *';
const BIN_CRON = '47 3 * * *';
const WATCHDOG_CRON = '* * * * *';

const env = parseEnv(baseEnvSchema.extend(calendarEnvSchema.shape));
const { db, pool } = createDatabase(env.DATABASE_URL);
await migrateOnStartup(pool);

const queue = await JobQueue.start(env.DATABASE_URL);
const settings = new SettingsStore(db, env.OPENMINUTES_SECRET);
const local = new LocalStorage(env.OPENMINUTES_DATA_DIR);
const processDeps = {
  db,
  mergeAudio,
  trimAudio,
  detectSilence,
  loadStorage: () => loadAudioStorage(settings, local),
  createTranscriber: () => createConfiguredTranscriber(settings, { fetch: longFetch }),
  createFallbackTranscriber: () => createFallbackTranscriber(settings),
  detectLanguage: createLanguageDetection(settings),
  createRefiner: async () => {
    if ((await settings.get('speakers.refine')) === 'false') return undefined;
    try {
      return (await createConfiguredSummarizer(settings)).provider;
    } catch (error) {
      if (error instanceof SummaryNotConfiguredError) return undefined;
      throw error;
    }
  },
  requestSummary: (meetingId: string) => requestSummary({ db, queue, settings }, meetingId),
  recording: createRecordingDeps(settings, (config) =>
    createLocalDiarizer(config, { fetch: longFetch }),
  ),
};
const summaryDeps = {
  db,
  settings,
  queue,
  createSummarizer: async (providerId: string) =>
    (await createConfiguredSummarizer(settings, providerId)).provider,
};
const calendar = {
  db,
  queue,
  settings,
  secret: env.OPENMINUTES_SECRET,
  providers: createProviders({ fakeBaseUrl: env.OPENMINUTES_FAKE_CALENDAR_URL }),
};

await queue.work('meeting.schedule', ({ meetingId }) =>
  scheduleMeeting({ db, queue, settings }, meetingId),
);
await queue.work('meeting.process', ({ meetingId, language }) =>
  processMeeting(processDeps, meetingId, language),
);
await queue.work('meeting.learn-voice', (job) =>
  learnVoice(
    {
      db,
      loadStorage: processDeps.loadStorage,
      createDiarizer: processDeps.recording.createDiarizer,
    },
    job,
  ),
);
await queue.work('meeting.review-speakers', ({ meetingId }) =>
  reviewMeetingSpeakers(processDeps, meetingId),
);
await queue.work('calendar.sync', ({ accountId }) => syncAccounts(calendar, accountId));
await queue.schedule('calendar.sync', SYNC_CRON, {});
await queue.work('meeting.summarize', ({ summaryId }) => runSummary(summaryDeps, summaryId));
await queue.work('audio.retention', async () => {
  const deleted = await deleteExpiredAudio({ db, settings, local });
  if (deleted > 0) console.log(`retention deleted the audio of ${deleted} meetings`);
});
await queue.schedule('audio.retention', RETENTION_CRON, {});
await queue.work('bin.purge', async () => {
  const storage = await loadAudioStorage(settings, local);
  const purged = await purgeExpiredBin({ db, storage, now: new Date() });
  if (purged > 0) console.log(`bin purged ${purged} meetings`);
});
await queue.schedule('bin.purge', BIN_CRON, {});
const watchdog = async () => {
  const stuck = await failStuckMeetings(db, {
    lobbyTimeoutSeconds: await settings.getNumber('bot.lobby_timeout_seconds'),
    maxDurationMinutes: await settings.getNumber('bot.max_duration_minutes'),
  });
  for (const { id, reason } of stuck) console.log(`watchdog failed meeting ${id}: ${reason}`);
};
await queue.work('meeting.watchdog', watchdog);
await queue.schedule('meeting.watchdog', WATCHDOG_CRON, {});
await watchdog();
console.log('worker ready');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void queue.stop().then(() => pool.end());
  });
}
