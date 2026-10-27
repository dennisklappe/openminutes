import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export interface FirefliesMeeting {
  id: string;
  title: string;
  url: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  /** Invited email addresses, without the Fireflies notetaker. */
  attendees: string[];
  hasAudio: boolean;
}

const metadataSchema = z.object({
  attendees: z.array(z.string()).default([]),
  meetingTitle: z.string().default(''),
  meetingStartTime: z.iso.datetime({ offset: true }),
  meetingEndTime: z.iso.datetime({ offset: true }).optional(),
  meetingDuration: z.number().nonnegative().optional(),
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTETAKER = /@(.+\.)?fireflies\.ai$/i;
const MINUTE_MS = 60_000;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

function attendeesOf(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  return emails
    .map((email) => email.trim().toLowerCase())
    .filter((email) => {
      const key = email.toLowerCase();
      if (!EMAIL.test(email) || NOTETAKER.test(email) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Reads the metadata of one meeting folder written by `extractExport` and whether it has a
 * recording. The Fireflies transcript and summary are not read. Throws on unusable metadata.
 */
export async function readFirefliesMeeting(dir: string, id: string): Promise<FirefliesMeeting> {
  const [raw, hasAudio] = await Promise.all([
    readFile(join(dir, 'metadata.json'), 'utf8'),
    exists(join(dir, 'audio.mp3')),
  ]);
  const metadata = metadataSchema.parse(JSON.parse(raw));
  const startedAt = new Date(metadata.meetingStartTime);
  const scheduledMs = metadata.meetingEndTime
    ? Date.parse(metadata.meetingEndTime) - startedAt.getTime()
    : 0;
  const durationMs =
    metadata.meetingDuration === undefined
      ? Math.max(scheduledMs, 0)
      : Math.round(metadata.meetingDuration * MINUTE_MS);
  return {
    id,
    title: metadata.meetingTitle.trim() || 'Fireflies meeting',
    url: `https://app.fireflies.ai/view/${id}`,
    startedAt,
    endedAt: new Date(startedAt.getTime() + durationMs),
    durationMs,
    attendees: attendeesOf(metadata.attendees),
    hasAudio,
  };
}
