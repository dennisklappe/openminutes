import { RECONCILE_LOCK_ID } from '@openminutes/calendar';
import { linkMeetingPeople } from '@openminutes/core';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  meetingCalendarLinks,
  meetingSources,
  meetings,
  sql,
  type CalendarInvitee,
  type Database,
} from '@openminutes/db';
import type { LinkableEventDto } from '../dto.js';
import { expectedInvitees, expectedPeople, speakerHint } from './link-pick.js';

type Meeting = typeof meetings.$inferSelect;

export class LinkEventError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

const RECORDED: readonly Meeting['platform'][] = ['recording', 'imported'];
/**
 * A calendar meeting nobody recorded: the bot has not joined it and will not. One that is over
 * counts as cancelled, which is when most recordings are linked.
 */
const LINKABLE: readonly Meeting['status'][] = ['scheduled', 'skipped', 'cancelled'];
/** Still to be transcribed, so a speaker count set now is used by the transcription. */
const NOT_TRANSCRIBED: readonly Meeting['status'][] = ['uploading', 'ended', 'processing'];
const NAMES = 4;
export const DEFAULT_LINKABLE = 50;
export const MAX_LINKABLE = 200;

/** The calendar meetings starting in a window that a recording can still be linked to. */
export async function listLinkableEvents(
  db: Database,
  from: Date,
  to: Date,
  limit = DEFAULT_LINKABLE,
): Promise<LinkableEventDto[]> {
  const rows = await db
    .select()
    .from(meetings)
    .where(
      and(
        inArray(meetings.status, [...LINKABLE]),
        isNull(meetings.deletedAt),
        gte(meetings.scheduledStart, from),
        lte(meetings.scheduledStart, to),
      ),
    )
    .orderBy(asc(meetings.scheduledStart))
    .limit(Math.min(limit, MAX_LINKABLE));
  return rows.flatMap((row): LinkableEventDto[] => {
    if (
      !row.scheduledStart ||
      (row.status !== 'scheduled' && row.status !== 'skipped' && row.status !== 'cancelled')
    ) {
      return [];
    }
    const invited = expectedInvitees(row.invitees, row.dismissedInvitees);
    return [
      {
        id: row.id,
        title: row.title,
        scheduledStart: row.scheduledStart.toISOString(),
        status: row.status,
        location: row.location,
        people: invited.length,
        names: invited.slice(0, NAMES).map((invitee) => invitee.name ?? invitee.email),
      },
    ];
  });
}

/** The invitees of the event first, then the ones the recording already knew that it does not list. */
function mergeInvitees(
  event: readonly CalendarInvitee[] | null,
  known: readonly CalendarInvitee[] | null,
): CalendarInvitee[] {
  const merged = [...(event ?? [])];
  for (const invitee of known ?? []) {
    if (!merged.some((entry) => entry.email.toLowerCase() === invitee.email.toLowerCase())) {
      merged.push(invitee);
    }
  }
  return merged;
}

const mergeEmails = (a: readonly string[] | null, b: readonly string[] | null) => {
  const merged = [...(a ?? [])];
  for (const email of b ?? []) {
    if (!merged.some((entry) => entry.toLowerCase() === email.toLowerCase())) merged.push(email);
  }
  return merged;
};

/**
 * Links a recording or import to a calendar meeting the bot did not record. The recording takes
 * over what the calendar knows (invitees, title, date, room, company, folder) and the calendar
 * event itself: its source moves to the recording, so a later sync finds the event already
 * covered by a finished meeting and leaves it alone. The scheduled row is then removed, or it
 * would still show as a skipped or upcoming meeting. The invitees are given their profiles like
 * those of any meeting. The recording keeps its own audio, transcript and id.
 *
 * A recording that is linked already is moved to the other meeting: the old calendar event is
 * released (a later sync places it again if it is still ahead) and the title, date and invitees
 * of the new one replace those of the old.
 */
export async function linkRecordingToEvent(
  db: Database,
  recordingId: string,
  eventId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${RECONCILE_LOCK_ID})`);
    const [recording] = await tx.select().from(meetings).where(eq(meetings.id, recordingId));
    if (!recording || recording.deletedAt || !RECORDED.includes(recording.platform)) {
      throw new LinkEventError('Recording not found', 404);
    }
    const [event] = await tx.select().from(meetings).where(eq(meetings.id, eventId));
    if (!event || event.deletedAt) throw new LinkEventError('Calendar meeting not found', 404);
    if (!LINKABLE.includes(event.status) || RECORDED.includes(event.platform)) {
      throw new LinkEventError('That calendar meeting cannot be linked to a recording', 409);
    }

    const [linked] = await tx
      .select({ id: meetingSources.id })
      .from(meetingSources)
      .where(eq(meetingSources.meetingId, recordingId))
      .limit(1);
    const moving = linked !== undefined;
    // What the old meeting gave the recording is not told apart from what it had itself.
    const invitees = mergeInvitees(event.invitees, moving ? null : recording.invitees);
    // The invitation says who is expected, not the attendees an import brought along.
    const hint = speakerHint(expectedPeople(event.invitees, event.dismissedInvitees));
    await tx
      .update(meetings)
      .set({
        // Marked as set, or the recording would be retitled from its summary.
        ...((moving || !recording.titleEdited) && { title: event.title, titleEdited: true }),
        scheduledStart: event.scheduledStart,
        seriesKey: event.seriesKey,
        location: event.location,
        invitees,
        dismissedInvitees: mergeEmails(
          event.dismissedInvitees,
          moving ? null : recording.dismissedInvitees,
        ),
        ...(recording.startedAt === null && { startedAt: event.scheduledStart }),
        ...(recording.company === null &&
          event.company !== null && { company: event.company, companySource: event.companySource }),
        ...(recording.folderId === null && { folderId: event.folderId }),
        ...(recording.speakerCount === null &&
          hint !== undefined &&
          NOT_TRANSCRIBED.includes(recording.status) && { speakerCount: hint }),
      })
      .where(eq(meetings.id, recordingId));
    // The calendar links of a source go with it.
    if (moving) await tx.delete(meetingSources).where(eq(meetingSources.meetingId, recordingId));
    await tx
      .update(meetingSources)
      .set({ meetingId: recordingId })
      .where(eq(meetingSources.meetingId, eventId));
    await tx
      .update(meetingCalendarLinks)
      .set({ meetingId: recordingId })
      .where(eq(meetingCalendarLinks.meetingId, eventId));
    await tx.delete(meetings).where(eq(meetings.id, eventId));
  });
  try {
    await linkMeetingPeople(db, recordingId);
  } catch (error) {
    console.error(`the people of meeting ${recordingId} could not be saved`, error);
  }
}

/**
 * Lets go of the calendar event a recording is linked to. The recording keeps the title, date and
 * invitees it took from it.
 */
export async function unlinkRecordingFromEvent(db: Database, recordingId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${RECONCILE_LOCK_ID})`);
    const [recording] = await tx.select().from(meetings).where(eq(meetings.id, recordingId));
    if (!recording || recording.deletedAt || !RECORDED.includes(recording.platform)) {
      throw new LinkEventError('Recording not found', 404);
    }
    const released = await tx
      .delete(meetingSources)
      .where(eq(meetingSources.meetingId, recordingId))
      .returning({ id: meetingSources.id });
    if (released.length === 0) {
      throw new LinkEventError('This recording is not linked to a calendar meeting', 409);
    }
  });
}
