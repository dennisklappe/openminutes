import { join } from 'node:path';
import {
  removeStagedMeeting,
  stagedMeetingFolder,
  type AudioStorage,
  type ImportJobPayload,
  type JobSender,
  type LocalStorage,
} from '@openminutes/core';
import { eq, meetings, type Database } from '@openminutes/db';
import { storeImportedAudio } from './import-audio.js';
import type { ProbeDuration } from './probe-duration.js';
import { Run } from './run-progress.js';

export interface ImportDeps {
  db: Database;
  queue: JobSender;
  local: LocalStorage;
  loadStorage: () => Promise<AudioStorage>;
  probeDuration: ProbeDuration;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Turns the recording of one meeting of an export into a meeting of the library and hands it to
 * the normal processing, which transcribes it and writes the summary like for any recording. The
 * Fireflies transcript and summary are never read. A retry after a crash finds the audio in place.
 * A failure marks this meeting only.
 */
export async function importMeeting(deps: ImportDeps, job: ImportJobPayload): Promise<void> {
  const { meetingId, uploadId, firefliesId } = job;
  const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (meeting?.status !== 'ended' && meeting?.status !== 'processing') return;

  await deps.db
    .update(meetings)
    .set({ status: 'processing', error: null })
    .where(eq(meetings.id, meetingId));
  const run = new Run(deps.db, meetingId);
  await run.begin();
  try {
    const folder = deps.local.absolutePath(stagedMeetingFolder(uploadId, firefliesId));
    await run.step('preparing');
    await storeImportedAudio(deps, await deps.loadStorage(), meetingId, join(folder, 'audio.mp3'));
    await removeStagedMeeting(deps.local, uploadId, firefliesId);
    await run.finish();
    await deps.db.update(meetings).set({ status: 'ended' }).where(eq(meetings.id, meetingId));
    await deps.queue.send('meeting.process', { meetingId });
  } catch (error) {
    run.stop();
    if (run.wasCancelled) return;
    console.error(`import of meeting ${meetingId} failed`, error);
    await deps.db
      .update(meetings)
      .set({ status: 'failed', error: `Import failed: ${errorMessage(error)}` })
      .where(eq(meetings.id, meetingId));
  }
}
