#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {
  baseEnvSchema,
  createMeeting,
  DuplicateMeetingError,
  JobQueue,
  parseEnv,
  UnsupportedMeetingUrlError,
} from '@openminutes/core';
import { createDatabase, migrateOnStartup } from '@openminutes/db';

const USAGE = 'Usage: openminutes join <meeting-url> [--title <title>] [--force]';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { title: { type: 'string' }, force: { type: 'boolean' } },
});
const [command, url] = positionals;
if (command !== 'join' || !url) {
  console.error(USAGE);
  process.exit(2);
}

const env = parseEnv(baseEnvSchema);
const { db, pool } = createDatabase(env.DATABASE_URL);
await migrateOnStartup(pool);
const queue = await JobQueue.start(env.DATABASE_URL);
try {
  const meeting = await createMeeting(
    { db, queue },
    { url, title: values.title, force: values.force },
  );
  console.log(`Queued ${meeting.title} (${meeting.id})`);
} catch (error) {
  if (!(error instanceof UnsupportedMeetingUrlError || error instanceof DuplicateMeetingError)) {
    throw error;
  }
  console.error(
    error instanceof DuplicateMeetingError
      ? `${error.message} Use --force to join anyway.`
      : error.message,
  );
  process.exitCode = 1;
} finally {
  await queue.stop();
  await pool.end();
}
