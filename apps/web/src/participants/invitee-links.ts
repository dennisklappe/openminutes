import { eq, meetings, participants, type Database } from '@openminutes/db';

type Meeting = typeof meetings.$inferSelect;

/** The stored spelling of an invitee email, or undefined when this meeting did not invite it. */
export function invitedEmail(meeting: Meeting, email: string): string | undefined {
  const wanted = email.trim().toLowerCase();
  return meeting.invitees?.find((invitee) => invitee.email.toLowerCase() === wanted)?.email;
}

/** The stored spellings of the invitees a person is, or false when one was not invited here. */
export function resolveLinks(meeting: Meeting, emails: readonly string[]): string[] | false {
  const found: string[] = [];
  for (const email of emails) {
    const stored = invitedEmail(meeting, email);
    if (stored === undefined) return false;
    if (!found.some((entry) => entry.toLowerCase() === stored.toLowerCase())) found.push(stored);
  }
  return found;
}

/** The address a person is known by: their own, else the first invitee they are. */
export const personEmail = (person: { email: string | null; inviteeEmails: readonly string[] }) =>
  person.email ?? person.inviteeEmails[0] ?? null;

/** Adds an invitee to the ones a participant is, or with null removes all links. */
export async function linkInvitee(
  db: Database,
  participantId: string,
  email: string | null,
): Promise<void> {
  const [person] = await db.select().from(participants).where(eq(participants.id, participantId));
  if (!person) return;
  const current = person.inviteeEmails;
  const next =
    email === null
      ? []
      : current.some((entry) => entry.toLowerCase() === email.toLowerCase())
        ? current
        : [...current, email];
  if (next === current) return;
  await db
    .update(participants)
    .set({ inviteeEmails: next })
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
