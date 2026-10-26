import { loadStaged } from '@openminutes/core';
import type { LocalStorage } from '@openminutes/core';
import { inArray, meetings, type Database } from '@openminutes/db';
import type { ImportMeetingDto, ImportPreviewDto } from '../dto.js';

export const externalId = (firefliesId: string) => `fireflies:${firefliesId}`;

export async function loadPreview(
  deps: { db: Database; storage: LocalStorage },
  uploadId: string,
): Promise<ImportPreviewDto | undefined> {
  const staged = await loadStaged(deps.storage, uploadId);
  if (!staged) return undefined;
  const made = await deps.db
    .select({
      id: meetings.id,
      externalId: meetings.externalId,
      status: meetings.status,
      error: meetings.error,
      processingStep: meetings.processingStep,
      processingCurrent: meetings.processingCurrent,
      processingTotal: meetings.processingTotal,
      processingStartedAt: meetings.processingStartedAt,
    })
    .from(meetings)
    .where(
      inArray(
        meetings.externalId,
        staged.meetings.map(({ id }) => externalId(id)),
      ),
    );
  const byKey = new Map(made.map((row) => [row.externalId, row]));
  return {
    id: uploadId,
    unreadable: staged.unreadable,
    meetings: staged.meetings.map((meeting): ImportMeetingDto => {
      const row = byKey.get(externalId(meeting.id));
      return {
        key: meeting.id,
        title: meeting.title,
        startedAt: meeting.startedAt,
        durationMs: meeting.durationMs,
        attendees: meeting.attendees,
        hasAudio: meeting.hasAudio,
        meeting: row
          ? {
              id: row.id,
              status: row.status,
              error: row.error,
              progress:
                row.status === 'processing'
                  ? {
                      step: row.processingStep,
                      current: row.processingCurrent,
                      total: row.processingTotal,
                      startedAt: row.processingStartedAt?.toISOString() ?? null,
                    }
                  : null,
            }
          : null,
      };
    }),
  };
}
