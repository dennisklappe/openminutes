import type { JobSender, SettingsStore } from '@openminutes/core';
import { and, eq, meetingExports, type Database } from '@openminutes/db';
import { loadExportConfig } from './export-settings.js';

/** Edits within this time end up in one commit. */
export const RESYNC_DELAY_SECONDS = 15;

/**
 * Commits an edited meeting to GitHub again, but only when GitHub is the automatic export target
 * and the meeting already has a folder there. The export job updates that folder.
 */
export async function queueGithubResync(
  deps: { db: Database; settings: SettingsStore; queue: JobSender },
  meetingId: string,
): Promise<void> {
  const config = await loadExportConfig(deps.settings);
  if (!config.auto || config.target !== 'github') return;
  const [record] = await deps.db
    .select({ ref: meetingExports.ref })
    .from(meetingExports)
    .where(and(eq(meetingExports.meetingId, meetingId), eq(meetingExports.exporterId, 'github')));
  if (!record) return;
  await deps.queue.send(
    'meeting.export',
    { meetingId },
    { startAfter: new Date(Date.now() + RESYNC_DELAY_SECONDS * 1000) },
  );
}
