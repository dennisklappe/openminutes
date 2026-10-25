import { binExpiry } from '@openminutes/core';
import type { meetings } from '@openminutes/db';
import type { MeetingDto } from '../dto.js';

export const iso = (date: Date | null) => date?.toISOString() ?? null;

export function toMeetingDto(row: typeof meetings.$inferSelect): MeetingDto {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    joinUrl: row.joinUrl,
    status: row.status,
    error: row.error,
    speakersRefined: row.speakersRefined,
    language: row.language,
    speakerCount: row.speakerCount,
    progress:
      row.status === 'processing'
        ? {
            step: row.processingStep,
            current: row.processingCurrent,
            total: row.processingTotal,
            startedAt: iso(row.processingStartedAt),
          }
        : null,
    titleEdited: row.titleEdited,
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    archivedAt: iso(row.archivedAt),
    deletedAt: iso(row.deletedAt),
    purgeAt: row.deletedAt && iso(binExpiry(row.deletedAt)),
    createdAt: row.createdAt.toISOString(),
  };
}
