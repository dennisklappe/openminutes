import {
  activeMeetingStatuses,
  meetings,
  type Database,
  type MeetingStatus,
} from '@openminutes/db';
import { defaultMeetingTitle, parseMeetingLink, platformById } from '@openminutes/platforms';
import { findJoinConflict } from './join-conflict.js';
import type { JobSender } from './queue.js';

export class UnsupportedMeetingUrlError extends Error {
  constructor(url: string) {
    super(`Not a supported meeting link: ${url}`);
    this.name = 'UnsupportedMeetingUrlError';
  }
}

export class DuplicateMeetingError extends Error {
  constructor(readonly existing: { id: string; title: string; status: MeetingStatus }) {
    super(
      (activeMeetingStatuses as readonly string[]).includes(existing.status)
        ? `The bot is already in this meeting ("${existing.title}").`
        : `The bot joined this meeting ("${existing.title}") a few minutes ago.`,
    );
    this.name = 'DuplicateMeetingError';
  }
}

export interface NewMeeting {
  url: string;
  title?: string | undefined;
  scheduledStart?: Date | undefined;
  force?: boolean | undefined;
}

export async function createMeeting(deps: { db: Database; queue: JobSender }, input: NewMeeting) {
  const joinUrl = input.url.trim();
  const link = parseMeetingLink(joinUrl);
  const platform = link && platformById(link.platform);
  if (!link || !platform) throw new UnsupportedMeetingUrlError(joinUrl);

  if (!input.force) {
    const conflict = await findJoinConflict(deps.db, link.key);
    if (conflict) throw new DuplicateMeetingError(conflict);
  }

  const title = input.title?.trim() || defaultMeetingTitle(platform.label, link);
  const [meeting] = await deps.db
    .insert(meetings)
    .values({
      title,
      platform: platform.id,
      joinUrl: link.canonicalUrl,
      joinKey: link.key,
      allowDuplicate: input.force === true,
      scheduledStart: input.scheduledStart ?? null,
    })
    .returning();
  if (!meeting) throw new Error('Meeting insert returned no row');

  await deps.queue.send('meeting.schedule', { meetingId: meeting.id });
  return meeting;
}
