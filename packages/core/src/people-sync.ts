import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  meetingInvitees,
  meetings,
  participants,
  people,
  sql,
  type CalendarInvitee,
  type Database,
  type PersonSource,
} from '@openminutes/db';
import { displayNameOf, matchInvitees, normalise } from '@openminutes/minutes';
import { cleanEmails } from './people.js';
import { isSharedTile } from './shared-accounts.js';

type Person = typeof people.$inferSelect;

/** Notetakers, recorders and meeting assistants: they are in the call but are nobody to meet. */
const BOT_NAME = [
  /note\s?taker/i,
  /\brecorder\b/i,
  /^(fireflies|read\.ai|otter\.ai|otter|fathom|tl;?dv|grain|avoma|sembly|krisp|fellow)\b/i,
  /\b(fireflies|read\.ai|otter\.ai)\b/i,
  /\bmeeting (bot|assistant)\b/i,
  /\bai (assistant|notes?)\b/i,
];

const PLACEHOLDER_NAME = [
  /^speaker\s*\d*$/i,
  /^(guest|unknown|anonymous|participant|attendee|user|caller|host|presenter)(\s+\d+)?$/i,
  /^unknown (speaker|participant|user|caller)(\s+\d+)?$/i,
  /^(guest|speaker|participant) user$/i,
  /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i,
  /^\+?[\d\s().-]{5,}$/,
  /^[\d\s-]+$/,
];

const BOT_DOMAIN =
  /(^|\.)(fireflies\.ai|read\.ai|otter\.ai|fathom\.video|tldv\.io|grain\.com|avoma\.com|sembly\.ai|krisp\.ai|fellow\.app|resource\.calendar\.google\.com)$/i;
const ROLE_LOCAL =
  /^(info|admin|administratie|administration|support|sales|office|team|hello|hallo|contact|mail|service|billing|finance|hr|reception|receptie|boekhouding|secretariaat|planning|bookings?)$/i;
const SYSTEM_LOCAL = /^(no-?reply|do-?not-?reply|notifications?|calendar|invites?)$/i;

export const looksLikeBot = (name: string) => BOT_NAME.some((pattern) => pattern.test(name));
export const isPlaceholderName = (name: string) =>
  PLACEHOLDER_NAME.some((pattern) => pattern.test(name.trim()));

function personalEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  return !BOT_DOMAIN.test(email.slice(at + 1)) && !SYSTEM_LOCAL.test(email.slice(0, at));
}

/** The name to file a person under, or undefined when this is not someone to keep. */
export function personNameFor(name: string | null | undefined, emails: readonly string[]) {
  const given = name?.trim() ?? '';
  if (given !== '' && looksLikeBot(given)) return undefined;
  if (given !== '' && !isPlaceholderName(given) && !given.includes('@')) return given;
  const [email] = emails;
  const derived =
    email && !ROLE_LOCAL.test(email.slice(0, email.indexOf('@')))
      ? displayNameOf({ name: null, email })
      : '';
  return derived !== '' && !isPlaceholderName(derived) && !looksLikeBot(derived)
    ? derived
    : undefined;
}

export interface SyncStats {
  meetings: number;
  /** People made from someone who was in a meeting. */
  createdJoined: number;
  /** People made from an invitee who never joined. */
  createdInvited: number;
  /** Participants that now point at a person. */
  linked: number;
  /** Invitee links added. */
  invitedLinks: number;
  /** Participants and invitees that are bots or placeholders, or shared mailboxes. */
  skipped: number;
  /** Participants and invitees that already had a person. */
  matched: number;
  /** Auto-created invited-only people removed because they are shared mailboxes. */
  removed: number;
}

const newStats = (): SyncStats => ({
  meetings: 0,
  createdJoined: 0,
  createdInvited: 0,
  linked: 0,
  invitedLinks: 0,
  skipped: 0,
  matched: 0,
  removed: 0,
});

/** Invited to this many meetings and never joined: a shared mailbox or a resource, not a person. */
export const SHARED_MAILBOX_INVITATIONS = 10;

/**
 * Emails invited to many meetings by someone who never joined any of them. Counted from the calendar
 * invitations of live meetings, so it also works before the person exists. Anyone with a joined or
 * manual profile, or an email seen on a participant, is never in it.
 */
export async function sharedMailboxEmails(db: Database): Promise<Set<string>> {
  const { rows } = await db.execute<{ email: string }>(sql`
    with invited as (
      select lower(i.value->>'email') as email, count(distinct m.id) as n
      from meetings m, jsonb_array_elements(coalesce(m.invitees, '[]'::jsonb)) i
      where m.deleted_at is null and coalesce(i.value->>'email', '') <> ''
      group by 1
    )
    select email from invited
    where n >= ${SHARED_MAILBOX_INVITATIONS}
      and not exists (
        select 1 from participants p
        where lower(p.email) = invited.email or p.invitee_emails ? invited.email
      )
      and not exists (
        select 1 from people pe
        where pe.emails ? invited.email
          and (pe.source <> 'invited' or exists (select 1 from participants q where q.person_id = pe.id))
      )`);
  return new Set(rows.map((row) => row.email));
}

/**
 * Deletes auto-created invited-only people who were invited to {@link SHARED_MAILBOX_INVITATIONS}
 * or more meetings and never joined one. Anyone the owner touched stays: a joined or manual source
 * (a merge or a manual add), notes, tracking switched off, or any later edit.
 */
export async function removeSharedMailboxes(db: Database): Promise<number> {
  const { rows } = await db.execute<{ id: string }>(sql`
    delete from people p
    where p.source = 'invited'
      and p.tracking = 'on'
      and p.notes is null
      and p.updated_at - p.created_at < interval '1 second'
      and not exists (select 1 from participants x where x.person_id = p.id)
      and not exists (select 1 from voice_samples v where v.person_id = p.id)
      and (select count(*) from meeting_invitees mi where mi.person_id = p.id) >= ${SHARED_MAILBOX_INVITATIONS}
    returning p.id`);
  return rows.length;
}

/** The one-off clean-up of shared mailboxes made by an earlier backfill, with a log line. */
export async function cleanupSharedMailboxes(db: Database): Promise<number> {
  const removed = await removeSharedMailboxes(db);
  console.log(`people cleanup: removed ${String(removed)} shared mailboxes`);
  return removed;
}

const logStats = (what: string, stats: SyncStats) => {
  console.log(
    `${what}: ${String(stats.meetings)} meetings, created ${String(stats.createdJoined)} joined and ${String(stats.createdInvited)} invited people, matched ${String(stats.matched)}, skipped ${String(stats.skipped)}, removed ${String(stats.removed)} shared mailboxes, linked ${String(stats.linked)} participants and ${String(stats.invitedLinks)} invitations`,
  );
};

/** Everyone known, found by any email or by exact name. Never merges two people. */
class PeopleIndex {
  private readonly byEmail = new Map<string, Person[]>();
  private readonly byName = new Map<string, Person>();

  constructor(
    private readonly db: Database,
    rows: readonly Person[],
  ) {
    for (const row of rows) this.add(row);
  }

  private add(person: Person) {
    this.byName.set(normalise(person.name), person);
    for (const email of person.emails) {
      const owners = this.byEmail.get(email) ?? [];
      if (!owners.some((owner) => owner.id === person.id)) owners.push(person);
      this.byEmail.set(email, owners);
    }
  }

  private find(name: string, emails: readonly string[]): Person | undefined {
    const wanted = normalise(name);
    const owners = emails.flatMap((email) => this.byEmail.get(email) ?? []);
    return (
      owners.find((owner) => normalise(owner.name) === wanted) ??
      owners[0] ??
      this.byName.get(wanted)
    );
  }

  known(name: string, emails: readonly string[]): boolean {
    return this.find(name, emails) !== undefined;
  }

  /** The person for a name and emails, made when nobody fits. */
  async resolve(
    name: string,
    emails: readonly string[],
    source: PersonSource,
  ): Promise<{ person: Person; created: boolean }> {
    const found = this.find(name, emails);
    if (found) return { person: await this.enrich(found, emails, source), created: false };
    const [created] = await this.db
      .insert(people)
      .values({ name, emails: [...emails], source })
      .onConflictDoNothing()
      .returning();
    if (created) {
      this.add(created);
      return { person: created, created: true };
    }
    const [raced] = await this.db
      .select()
      .from(people)
      .where(sql`lower(${people.name}) = lower(${name})`);
    if (!raced) throw new Error(`could not create the person ${name}`);
    this.add(raced);
    return { person: await this.enrich(raced, emails, source), created: false };
  }

  /** Adds emails nobody else owns and moves an invited person up to joined. */
  private async enrich(person: Person, emails: readonly string[], source: PersonSource) {
    const free = emails.filter(
      (email) =>
        !person.emails.includes(email) &&
        !(this.byEmail.get(email) ?? []).some((owner) => owner.id !== person.id),
    );
    const promote = source === 'joined' && person.source === 'invited';
    if (free.length === 0 && !promote) return person;
    const [saved] = await this.db
      .update(people)
      .set({
        ...(free.length > 0 && { emails: cleanEmails([...person.emails, ...free]) }),
        ...(promote && { source: 'joined' as const }),
        // Only a promotion counts as a change: sync adding an email must not look like an edit.
        ...(promote && { updatedAt: new Date() }),
      })
      .where(eq(people.id, person.id))
      .returning();
    const next = saved ?? person;
    this.add(next);
    return next;
  }
}

async function loadIndex(db: Database): Promise<PeopleIndex> {
  return new PeopleIndex(
    db,
    await db.select().from(people).orderBy(asc(people.createdAt), asc(people.id)),
  );
}

interface MeetingRow {
  id: string;
  invitees: CalendarInvitee[] | null;
  dismissedInvitees: string[] | null;
}

type ParticipantRow = typeof participants.$inferSelect;

async function syncMeeting(
  db: Database,
  index: PeopleIndex,
  meeting: MeetingRow,
  rows: readonly ParticipantRow[],
  stats: SyncStats,
  shared: ReadonlySet<string>,
): Promise<void> {
  stats.meetings++;
  const dismissed = new Set((meeting.dismissedInvitees ?? []).map((email) => email.toLowerCase()));
  const invitees = (meeting.invitees ?? []).filter(
    (invitee) =>
      !invitee.declined &&
      personalEmail(invitee.email) &&
      !dismissed.has(invitee.email.toLowerCase()),
  );
  const present = rows.filter((row) => !row.isBot);
  stats.skipped += rows.length - present.length;
  const matches = matchInvitees(
    invitees,
    present.map((row) => ({
      displayName: row.displayName,
      originalName: row.originalName,
      email: row.email,
      inviteeEmails: row.inviteeEmails,
    })),
  );

  const joined = new Set<string>();
  for (const [i, row] of present.entries()) {
    // A tile with several people is nobody: its voices are the people, and its email is not theirs.
    if (await isSharedTile(db, row)) {
      stats.skipped++;
      continue;
    }
    const emails = cleanEmails(
      [row.email, ...row.inviteeEmails, matches[i]?.email].filter(
        (email): email is string => !!email && personalEmail(email),
      ),
    );
    const name = personNameFor(row.displayName, emails);
    if (!name) {
      stats.skipped++;
      continue;
    }
    const { person, created } = await index.resolve(name, emails, 'joined');
    if (person.tracking === 'off') {
      stats.skipped++;
      continue;
    }
    if (created) stats.createdJoined++;
    else stats.matched++;
    joined.add(person.id);
    if (row.personId === null) {
      await db.update(participants).set({ personId: person.id }).where(eq(participants.id, row.id));
      stats.linked++;
    }
  }

  const taken = new Set(matches.flatMap((invitee) => (invitee ? [invitee.email] : [])));
  for (const invitee of invitees) {
    if (taken.has(invitee.email)) continue;
    const email = cleanEmails([invitee.email]);
    const name = personNameFor(invitee.name, email);
    if (!name) {
      stats.skipped++;
      continue;
    }
    if (shared.has(invitee.email.toLowerCase()) && !index.known(name, email)) {
      stats.skipped++;
      continue;
    }
    const { person, created } = await index.resolve(name, email, 'invited');
    if (person.tracking === 'off') {
      stats.skipped++;
      continue;
    }
    if (created) stats.createdInvited++;
    else stats.matched++;
    if (joined.has(person.id)) continue;
    const added = await db
      .insert(meetingInvitees)
      .values({ meetingId: meeting.id, personId: person.id })
      .onConflictDoNothing()
      .returning({ personId: meetingInvitees.personId });
    stats.invitedLinks += added.length;
  }
}

const BATCH = 200;

/**
 * Gives every person from every meeting a profile: each participant and each calendar invitee who
 * is not a bot or a placeholder. People are found by email, then by exact name, and are never
 * merged. Safe to run again: it only adds what is missing.
 */
export async function backfillPeople(db: Database): Promise<SyncStats> {
  const stats = newStats();
  stats.removed = await removeSharedMailboxes(db);
  const shared = await sharedMailboxEmails(db);
  const index = await loadIndex(db);
  let after: string | undefined;
  for (;;) {
    const batch = await db
      .select({
        id: meetings.id,
        invitees: meetings.invitees,
        dismissedInvitees: meetings.dismissedInvitees,
      })
      .from(meetings)
      .where(and(isNull(meetings.deletedAt), after ? gt(meetings.id, after) : undefined))
      .orderBy(asc(meetings.id))
      .limit(BATCH);
    if (batch.length === 0) break;
    const rows = await db
      .select()
      .from(participants)
      .where(
        inArray(
          participants.meetingId,
          batch.map((meeting) => meeting.id),
        ),
      );
    for (const meeting of batch) {
      await syncMeeting(
        db,
        index,
        meeting,
        rows.filter((row) => row.meetingId === meeting.id),
        stats,
        shared,
      );
    }
    after = batch.at(-1)?.id;
  }
  logStats('people backfill', stats);
  return stats;
}

/** Finds or makes the person of everyone in one meeting, once its participants are final. */
export async function linkMeetingPeople(db: Database, meetingId: string): Promise<SyncStats> {
  const stats = newStats();
  const [meeting] = await db
    .select({
      id: meetings.id,
      invitees: meetings.invitees,
      dismissedInvitees: meetings.dismissedInvitees,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  if (!meeting) return stats;
  const rows = await db.select().from(participants).where(eq(participants.meetingId, meetingId));
  await syncMeeting(db, await loadIndex(db), meeting, rows, stats, await sharedMailboxEmails(db));
  return stats;
}
