import { cleanEmails, findPersonByName } from '@openminutes/core';
import type { meetings } from '@openminutes/db';
import { and, eq, ne, participants, people, sql, type Database } from '@openminutes/db';
import type { IdentityInviteeDto, SpeakerIdentityDto } from '../dto.js';
import { PeopleError, updatePerson } from '../people/edit.js';
import { nameVoice } from '../voices/rename.js';
import { resolveLinks } from './invitee-links.js';
import { renameParticipant } from './rename.js';
import { assertSharedLinksFree, isSubSeat } from './shared-rules.js';

type Meeting = typeof meetings.$inferSelect;
type Seat = typeof participants.$inferSelect;

const GENERIC_NAME = /^Speaker \d+$/;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function holderOf(db: Database, email: string, except: string | undefined) {
  const [owner] = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(and(sql`${people.emails} ? ${email}`, except ? ne(people.id, except) : undefined));
  return owner;
}

export async function loadIdentity(
  db: Database,
  meeting: Meeting,
  seat: Seat,
  typedName?: string,
): Promise<SpeakerIdentityDto> {
  const [person] = seat.personId
    ? await db.select().from(people).where(eq(people.id, seat.personId))
    : [];
  const invitees: IdentityInviteeDto[] = [];
  for (const invitee of meeting.invitees ?? []) {
    const owner = await holderOf(db, invitee.email.toLowerCase(), person?.id);
    invitees.push({ ...invitee, takenBy: owner?.name ?? null });
  }
  const wanted = typedName?.trim();
  const twin = wanted ? await findPersonByName(db, wanted) : undefined;
  const sibling = wanted
    ? (await db.select().from(participants).where(eq(participants.meetingId, seat.meetingId))).find(
        (other) => other.id !== seat.id && same(other.displayName, wanted),
      )
    : undefined;
  const found = twin && twin.id !== person?.id ? twin : undefined;
  const match = found
    ? { personId: found.id, name: found.name }
    : sibling
      ? { personId: sibling.personId, name: sibling.displayName }
      : null;
  return {
    participantId: seat.id,
    personId: person?.id ?? null,
    name: seat.displayName,
    originalName:
      seat.originalName && !same(seat.originalName, seat.displayName) ? seat.originalName : null,
    emails: person?.emails ?? [],
    invitees,
    match,
    nameLocked: await isSubSeat(db, seat),
  };
}

export interface IdentityChange {
  name: string;
  emails: string[];
  remember: boolean;
  move: boolean;
}

/**
 * Renames a speaker the way the existing rename does and sets the addresses of its person to
 * exactly `emails`. Everything is checked before the first write. Returns the seat that is left
 * (a recording merges two voices that get one name) and whether the summary was rewritten.
 */
export async function saveIdentity(
  db: Database,
  meeting: Meeting,
  seat: Seat,
  change: IdentityChange,
): Promise<{ seatId: string; summaryUpdated: boolean }> {
  const renamed = change.name !== seat.displayName;
  if (renamed && (await isSubSeat(db, seat))) {
    throw new PeopleError('Use Name to give this voice a name', 409);
  }
  const desired = cleanEmails(change.emails);
  const [current] = seat.personId
    ? await db.select().from(people).where(eq(people.id, seat.personId))
    : [];
  const twin = renamed ? await findPersonByName(db, change.name) : undefined;
  const target = twin && twin.id !== current?.id ? twin : current;
  if (!target && desired.length > 0 && GENERIC_NAME.test(change.name)) {
    throw new PeopleError('Give the speaker a name before adding emails', 400);
  }
  // Joining someone who exists keeps their addresses; only the ones taken off here go.
  const removed = new Set(
    current ? current.emails.filter((email) => !desired.includes(email)) : [],
  );
  const final = cleanEmails([
    ...(target && target !== current ? target.emails : []),
    ...desired,
  ]).filter((email) => !removed.has(email));
  for (const email of final) {
    if (target?.emails.includes(email)) continue;
    const owner = await holderOf(db, email, target?.id);
    if (owner) throw new PeopleError(`${email} already belongs to ${owner.name}`, 409);
  }
  const invited = (meeting.invitees ?? [])
    .map((invitee) => invitee.email)
    .filter((email) => final.includes(email.toLowerCase()));
  const links = resolveLinks(meeting, invited) || [];
  const typed = final.filter((email) => !links.some((link) => same(link, email)));
  const email =
    seat.email && typed.includes(seat.email.toLowerCase()) ? seat.email : (typed[0] ?? null);
  await assertSharedLinksFree(db, seat, { inviteeEmails: links, email }, change.move);

  // Renaming the person this speaker already is keeps their addresses and voices: rename the person
  // first, so the rename below joins them instead of creating a second person with the new name.
  if (renamed && current && !twin) await updatePerson(db, current.id, { name: change.name });
  let seatId = seat.id;
  let summaryUpdated = false;
  if (renamed && meeting.platform === 'recording') {
    await nameVoice(db, seat, change.name, change.remember);
    const left = await db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, seat.meetingId));
    seatId = left.find((other) => same(other.displayName, change.name))?.id ?? seat.id;
  } else if (renamed) {
    ({ summaryUpdated } = await renameParticipant(db, seat, change.name, change.remember, {
      inviteeEmails: links,
      email,
    }));
  }
  const [saved] = await db
    .update(participants)
    .set({ inviteeEmails: links, email })
    .where(eq(participants.id, seatId))
    .returning();
  if (saved?.personId) {
    const [now] = await db.select().from(people).where(eq(people.id, saved.personId));
    if (now && now.emails.join() !== final.join()) {
      await updatePerson(db, now.id, { emails: final });
    }
  }
  return { seatId, summaryUpdated };
}
