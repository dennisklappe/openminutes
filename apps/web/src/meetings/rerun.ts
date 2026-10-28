import type { SettingsStore } from '@openminutes/core';
import { audioFiles, eq, meetings, transcriptSegments, type Database } from '@openminutes/db';
import type { MeetingRerunDto } from '../dto.js';
import { checkEnabled } from '../voices/load.js';

type Meeting = typeof meetings.$inferSelect;

const hasRow = async (db: Database, query: Promise<unknown[]>) => (await query).length > 0;

/**
 * What the Re-run menu of a meeting may offer. Only a transcribed meeting with its recording can
 * be re-run. Finding the voices again needs voices told apart from the audio, so it is for phone
 * recordings and imports only: a Meet or Teams call has the speaking indicator.
 */
export async function rerunOptions(
  db: Database,
  settings: SettingsStore,
  meeting: Meeting,
): Promise<MeetingRerunDto> {
  const ready =
    meeting.status === 'transcribed' &&
    (await hasRow(
      db,
      db
        .select({ id: audioFiles.id })
        .from(audioFiles)
        .where(eq(audioFiles.meetingId, meeting.id))
        .limit(1),
    )) &&
    (await hasRow(
      db,
      db
        .select({ id: transcriptSegments.id })
        .from(transcriptSegments)
        .where(eq(transcriptSegments.meetingId, meeting.id))
        .limit(1),
    ));
  return {
    available: ready,
    speakers: ready && (meeting.platform === 'recording' || meeting.platform === 'imported'),
    voiceCheckOn: await checkEnabled(settings),
  };
}

/** Shows the meeting as processing again, the way the worker jobs of a re-run expect it. */
export async function markProcessing(
  db: Database,
  meetingId: string,
  extra: Partial<typeof meetings.$inferInsert> = {},
): Promise<void> {
  await db
    .update(meetings)
    .set({
      status: 'processing',
      error: null,
      processingStep: null,
      processingCurrent: null,
      processingTotal: null,
      processingStartedAt: new Date(),
      heartbeatAt: new Date(),
      ...extra,
    })
    .where(eq(meetings.id, meetingId));
}
