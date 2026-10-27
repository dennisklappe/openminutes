import {
  and,
  eq,
  participants,
  people,
  roomVoices,
  sharedAccountVoices,
  type Database,
} from '@openminutes/db';
import { PeopleError } from '../people/edit.js';

type Seat = typeof participants.$inferSelect;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** True for the seat of a person made for a voice of a shared account. */
export async function isSubSeat(db: Pick<Database, 'select'>, seat: Seat): Promise<boolean> {
  if (!seat.personId) return false;
  const [found] = await db
    .select({ n: sharedAccountVoices.number })
    .from(sharedAccountVoices)
    .where(eq(sharedAccountVoices.personId, seat.personId))
    .limit(1);
  return found !== undefined;
}

/**
 * The people of one shared tile each have their own addresses. An invitee, a typed address or
 * the address of the tile itself can belong to one of them only, and the tile's address is
 * theirs only when it was assigned. An invitee is also not shared with another participant of the
 * meeting. Throws a 409 that says who has it, or with `move` takes it from whoever has it.
 */
export async function assertSharedLinksFree(
  db: Database,
  seat: Pick<Seat, 'id' | 'meetingId' | 'personId'>,
  wanted: { inviteeEmails?: readonly string[] | undefined; email?: string | null | undefined },
  move = false,
): Promise<void> {
  const personId = seat.personId;
  const [own] = personId
    ? await db
        .select({ tileId: roomVoices.participantId })
        .from(roomVoices)
        .where(and(eq(roomVoices.meetingId, seat.meetingId), eq(roomVoices.personId, personId)))
        .limit(1)
    : [];
  // A participant who is nobody's voice cannot take an invitee a person of a tile has.
  const voices = own
    ? await db
        .select({ personId: roomVoices.personId })
        .from(roomVoices)
        .where(eq(roomVoices.participantId, own.tileId))
    : [];
  const siblingIds = new Set(
    voices.flatMap((v) => (v.personId && v.personId !== seat.personId ? [v.personId] : [])),
  );
  const seats = (
    await db.select().from(participants).where(eq(participants.meetingId, seat.meetingId))
  ).filter((s) => s.id !== seat.id && !s.isBot);
  const inTiles = own
    ? new Set<string>()
    : new Set(
        (
          await db
            .select({ personId: roomVoices.personId })
            .from(roomVoices)
            .where(eq(roomVoices.meetingId, seat.meetingId))
        ).flatMap((v) => (v.personId ? [v.personId] : [])),
      );
  const isSibling = (s: Seat) => s.personId !== null && siblingIds.has(s.personId);
  const isTilePerson = (s: Seat) => s.personId !== null && inTiles.has(s.personId);
  // A typed address or the tile's own address only clashes with the people of the same tile.
  const holder = (address: string, invitee: boolean) =>
    seats.find((s) =>
      isSibling(s)
        ? (s.email !== null && same(s.email, address)) ||
          s.inviteeEmails.some((e) => same(e, address))
        : invitee && (own || isTilePerson(s)) && s.inviteeEmails.some((e) => same(e, address)),
    );
  const taken: { seat: Seat; address: string }[] = [];
  const check = (address: string, invitee: boolean) => {
    const found = holder(address, invitee);
    if (!found) return;
    if (!move) throw new PeopleError(`${address} is ${found.displayName} already`, 409);
    taken.push({ seat: found, address });
  };
  for (const address of wanted.inviteeEmails ?? []) check(address, true);
  if (wanted.email) check(wanted.email, false);
  for (const { seat: found, address } of taken) {
    await db
      .update(participants)
      .set({
        inviteeEmails: found.inviteeEmails.filter((e) => !same(e, address)),
        email: found.email && same(found.email, address) ? null : found.email,
      })
      .where(eq(participants.id, found.id));
    if (found.personId) {
      const [owner] = await db.select().from(people).where(eq(people.id, found.personId));
      if (owner?.emails.some((e) => same(e, address))) {
        await db
          .update(people)
          .set({ emails: owner.emails.filter((e) => !same(e, address)), updatedAt: new Date() })
          .where(eq(people.id, owner.id));
      }
    }
  }
}
