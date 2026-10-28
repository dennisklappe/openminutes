import { and, eq, meetings, participants, people, sql, type Database } from '@openminutes/db';
import { cleanEmails } from '@openminutes/core';
import { PeopleError } from '../people/edit.js';

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

/**
 * Says an invitee is a person from People: their seat in the meeting (made when they have none)
 * gets the invitee, and the address joins the person's own unless another person has it.
 */
export async function linkInviteeToPerson(
  db: Database,
  meetingId: string,
  personId: string,
  email: string,
): Promise<typeof participants.$inferSelect> {
  const [person] = await db.select().from(people).where(eq(people.id, personId));
  if (!person) throw new PeopleError('Person not found', 404);
  const [seat] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.meetingId, meetingId), eq(participants.personId, personId)));
  const [saved] = seat
    ? await db
        .update(participants)
        .set({ inviteeEmails: cleanEmails([...seat.inviteeEmails, email]) })
        .where(eq(participants.id, seat.id))
        .returning()
    : await db
        .insert(participants)
        .values({
          meetingId,
          displayName: person.name,
          personId,
          nameConfirmed: true,
          inviteeEmails: [email],
        })
        .returning();
  if (!saved) throw new PeopleError('Could not link the invitee', 400);
  const taken = await db
    .select({ id: people.id })
    .from(people)
    .where(sql`${people.emails} ? ${email}`);
  if (taken.length === 0) {
    await db
      .update(people)
      .set({ emails: cleanEmails([...person.emails, email]), updatedAt: new Date() })
      .where(eq(people.id, personId));
  }
  return saved;
}
