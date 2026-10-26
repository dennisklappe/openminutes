import {
  readFirefliesMeeting,
  removeStagedMeeting,
  stagedMeetingFolder,
  type JobSender,
  type LocalStorage,
} from '@openminutes/core';
import { and, eq, meetings, type Database } from '@openminutes/db';
import type { ImportStartInput } from '../dto.js';
import { externalId } from './preview.js';

interface StartDeps {
  db: Database;
  queue: JobSender;
  storage: LocalStorage;
}

type StagedKey = { id: string; hasAudio: boolean };

/**
 * Creates the meeting for every chosen export entry with a recording and queues it. A meeting that failed earlier
 * is queued again, one that exists already is left alone. The files of every other entry are
 * removed: they are not needed any more. Its transcript and summary are never read: the normal
 * processing transcribes the recording and writes the summary.
 */
export async function startImport(
  deps: StartDeps,
  uploadId: string,
  staged: readonly StagedKey[],
  input: ImportStartInput,
): Promise<void> {
  const chosen = new Set(input.keys);
  for (const { id, hasAudio } of staged) {
    if (!chosen.has(id) || !hasAudio) {
      await removeStagedMeeting(deps.storage, uploadId, id);
      continue;
    }
    const meetingId = await claim(deps, uploadId, id);
    if (meetingId) {
      await deps.queue.send('meeting.import', {
        meetingId,
        uploadId,
        firefliesId: id,
      });
    } else if (!(await isRunning(deps.db, id))) {
      await removeStagedMeeting(deps.storage, uploadId, id);
    }
  }
}

async function isRunning(db: Database, id: string): Promise<boolean> {
  const [row] = await db
    .select({ status: meetings.status })
    .from(meetings)
    .where(eq(meetings.externalId, externalId(id)));
  return row?.status === 'ended' || row?.status === 'processing';
}

/** The id of the meeting to run an import for, undefined when it was imported already. */
async function claim(deps: StartDeps, uploadId: string, id: string): Promise<string | undefined> {
  const key = externalId(id);
  const [retry] = await deps.db
    .update(meetings)
    .set({ status: 'ended', error: null })
    .where(and(eq(meetings.externalId, key), eq(meetings.status, 'failed')))
    .returning({ id: meetings.id });
  if (retry) return retry.id;

  const meeting = await readFirefliesMeeting(
    deps.storage.absolutePath(stagedMeetingFolder(uploadId, id)),
    id,
  );
  const [created] = await deps.db
    .insert(meetings)
    .values({
      title: meeting.title,
      platform: 'imported',
      joinUrl: meeting.url,
      externalId: key,
      status: 'ended',
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      invitees: meeting.attendees.map((email) => ({ email, name: null, declined: false })),
    })
    .onConflictDoNothing()
    .returning({ id: meetings.id });
  return created?.id;
}
