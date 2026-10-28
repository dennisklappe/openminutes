import { MAX_SPEAKERS, MIN_SPEAKERS } from '../speakerCount.js';

type Invitee = { email: string; declined: boolean };

/** Pure helpers for linking a recording to a calendar meeting, shared by the server and the UI. */

/** A calendar event starts at most this long after the recording began... */
export const SUGGEST_AFTER_MS = 30 * 60_000;
/** ...and at most this long before it, to be the one that was probably recorded. */
export const SUGGEST_BEFORE_MS = 3 * 60 * 60_000;

/** Rooms and resources sit on the invitation but are nobody to meet. */
const isResource = (email: string) => email.toLowerCase().endsWith('@resource.calendar.google.com');

/** The invitees who are expected: not declined, not dismissed, not a room. */
export function expectedInvitees<T extends Invitee>(
  invitees: readonly T[] | null,
  dismissed: readonly string[] | null = null,
): T[] {
  const skip = new Set((dismissed ?? []).map((email) => email.toLowerCase()));
  const seen = new Set<string>();
  return (invitees ?? []).filter((invitee) => {
    const email = invitee.email.toLowerCase();
    if (invitee.declined || skip.has(email) || isResource(email) || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

/** How many people the invitation expects, null without one. */
export function expectedPeople(
  invitees: readonly Invitee[] | null,
  dismissed: readonly string[] | null = null,
): number | null {
  const people = expectedInvitees(invitees, dismissed).length;
  return people === 0 ? null : people;
}

/** The speaker count that fits an invitation: one person is no conversation, many are "5+". */
export function speakerHint(people: number | null): number | undefined {
  return people === null || people < MIN_SPEAKERS ? undefined : Math.min(people, MAX_SPEAKERS);
}

/** The meeting that starts closest to the time of the recording, when it is near enough to be it. */
export function suggestEvent<T extends { scheduledStart: string }>(
  events: readonly T[],
  at: Date,
): T | undefined {
  const time = at.getTime();
  return events
    .map((event) => ({ event, start: new Date(event.scheduledStart).getTime() }))
    .filter(({ start }) => start - time <= SUGGEST_AFTER_MS && time - start <= SUGGEST_BEFORE_MS)
    .sort((a, b) => Math.abs(a.start - time) - Math.abs(b.start - time))[0]?.event;
}

/** The meetings ordered by how close they start to a time, the likely one first. */
export function nearestFirst<T extends { scheduledStart: string }>(
  events: readonly T[],
  at: Date,
): T[] {
  const time = at.getTime();
  const distance = (event: T) => Math.abs(new Date(event.scheduledStart).getTime() - time);
  return events.toSorted((a, b) => distance(a) - distance(b));
}
