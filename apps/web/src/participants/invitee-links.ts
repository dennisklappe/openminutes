import { eq, meetings, participants, type Database } from '@openminutes/db';

type Meeting = typeof meetings.$inferSelect;

/** The stored spelling of an invitee email, or undefined when this meeting did not invite it. */
export function invitedEmail(meeting: Meeting, email: string): string | undefined {
  const wanted = email.trim().toLowerCase();
  return meeting.invitees?.find((invitee) => invitee.email.toLowerCase() === wanted)?.email;
}

/** undefined: leave as is, null: unlink, false: not an invitee of this meeting. */
export function resolveLink(meeting: Meeting, email: string | null | undefined) {
  if (email === undefined || email === null) return email;
  return invitedEmail(meeting, email) ?? false;
}

export async function linkInvitee(
  db: Database,
  participantId: string,
  email: string | null,
): Promise<void> {
  await db
    .update(participants)
    .set({ inviteeEmail: email })
    .where(eq(participants.id, participantId));
}

export async function dismissInvitee(db: Database, meeting: Meeting, email: string): Promise<void> {
  const dismissed = meeting.dismissedInvitees ?? [];
  if (dismissed.some((entry) => entry.toLowerCase() === email.toLowerCase())) return;
  await db
    .update(meetings)
    .set({ dismissedInvitees: [...dismissed, email] })
    .where(eq(meetings.id, meeting.id));
}
