import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  meetingInvitees,
  participants,
  people,
  roomVoices,
  sharedAccounts,
  sharedAccountVoices,
  sql,
  transcriptSegments,
  voiceSamples,
  type Database,
} from '@openminutes/db';
import { SUSPECT_CONFIDENCE_CAP } from './speaker-suspects.js';

type Writer = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

/** The most people one shared account can hold. */
export const SHARED_MAX_PEOPLE = 4;
/** Minutes the summary waits for the answer how many people sit in a shared account. */
export const SHARED_WAIT_DEFAULT_MINUTES = 15;
/** How often a waiting summary looks again. */
export const SHARED_WAIT_POLL_SECONDS = 20;

const squash = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Who a participant tile is across meetings: its email when it has one, else its normalised
 * display name. The same key means the same shared account.
 */
export function accountKey(tile: { email: string | null; displayName: string }): string {
  const email = tile.email?.trim().toLowerCase();
  return email ? `email:${email}` : `name:${squash(tile.displayName)}`;
}

/** The name of the person that stands for an unnamed voice of a shared account. */
export const placeholderName = (number: number, label: string) => `Voice ${number} (${label})`;

/** Minutes to wait for the answer, 0 meaning never wait. Anything unusable falls back to the default. */
export function waitMinutes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return SHARED_WAIT_DEFAULT_MINUTES;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), 24 * 60)
    : SHARED_WAIT_DEFAULT_MINUTES;
}

/** The count the owner gave for this tile before, undefined when the account is not remembered. */
export async function rememberedCount(
  db: Writer,
  tile: { email: string | null; displayName: string },
): Promise<number | undefined> {
  const [row] = await db
    .select({ count: sharedAccounts.count })
    .from(sharedAccounts)
    .where(eq(sharedAccounts.key, accountKey(tile)));
  return row?.count ?? undefined;
}

/** The row of a shared account, made when there is none. The count is only set when given. */
export async function ensureAccount(
  db: Writer,
  tile: { email: string | null; displayName: string },
  count?: number,
): Promise<{ id: string; key: string; label: string }> {
  const key = accountKey(tile);
  const [row] = await db
    .insert(sharedAccounts)
    .values({ key, label: tile.displayName.trim(), count: count ?? null })
    .onConflictDoUpdate({
      target: sharedAccounts.key,
      set: {
        label: tile.displayName.trim(),
        ...(count !== undefined && { count }),
      },
    })
    .returning({ id: sharedAccounts.id, key: sharedAccounts.key, label: sharedAccounts.label });
  if (!row) throw new Error('Could not save the shared account');
  return row;
}

/** Remembers "this account is N people", so the next meeting from it does not ask. */
export async function rememberCount(
  db: Writer,
  tile: { email: string | null; displayName: string },
  count: number,
): Promise<void> {
  await ensureAccount(db, tile, count);
}

export interface RememberedAccount {
  id: string;
  label: string;
  key: string;
  count: number;
  /** The people made for its voices, by voice number. */
  voices: { number: number; personId: string; name: string; unnamed: boolean }[];
}

export async function listRememberedAccounts(db: Writer): Promise<RememberedAccount[]> {
  const accounts = await db
    .select()
    .from(sharedAccounts)
    .where(isNotNull(sharedAccounts.count))
    .orderBy(asc(sharedAccounts.label));
  if (accounts.length === 0) return [];
  const voices = await db
    .select({
      accountId: sharedAccountVoices.accountId,
      number: sharedAccountVoices.number,
      personId: people.id,
      name: people.name,
      unnamed: people.unnamed,
    })
    .from(sharedAccountVoices)
    .innerJoin(people, eq(people.id, sharedAccountVoices.personId))
    .where(
      inArray(
        sharedAccountVoices.accountId,
        accounts.map((a) => a.id),
      ),
    )
    .orderBy(asc(sharedAccountVoices.number));
  return accounts.map((a) => ({
    id: a.id,
    label: a.label,
    key: a.key,
    count: a.count ?? 0,
    voices: voices.filter((v) => v.accountId === a.id),
  }));
}

/**
 * Forgets the remembered count, so the next meeting asks again. The people made for its voices
 * stay, and so does the link to them, so a later meeting reuses the same people.
 */
export async function forgetAccount(db: Writer, accountId: string): Promise<boolean> {
  const updated = await db
    .update(sharedAccounts)
    .set({ count: null })
    .where(eq(sharedAccounts.id, accountId))
    .returning({ id: sharedAccounts.id });
  return updated.length > 0;
}

async function freeName(db: Writer, wanted: string): Promise<string> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? wanted : `${wanted} ${n}`;
    const [twin] = await db
      .select({ id: people.id })
      .from(people)
      .where(sql`lower(${people.name}) = lower(${name})`);
    if (!twin) return name;
  }
}

/**
 * The person for voice `number` of an account: the one linked before, else a new unnamed one.
 * The same voice number gives the same person in every meeting and after reprocessing.
 */
export async function personForVoice(
  db: Writer,
  account: { id: string; label: string },
  number: number,
): Promise<{ id: string; name: string; unnamed: boolean }> {
  const [linked] = await db
    .select({ id: people.id, name: people.name, unnamed: people.unnamed })
    .from(sharedAccountVoices)
    .innerJoin(people, eq(people.id, sharedAccountVoices.personId))
    .where(
      and(eq(sharedAccountVoices.accountId, account.id), eq(sharedAccountVoices.number, number)),
    );
  if (linked) return linked;
  const name = await freeName(db, placeholderName(number, account.label));
  const [created] = await db
    .insert(people)
    .values({ name, source: 'joined', unnamed: true })
    .returning({ id: people.id, name: people.name, unnamed: people.unnamed });
  if (!created) throw new Error('Could not add the person');
  await db
    .insert(sharedAccountVoices)
    .values({ accountId: account.id, number, personId: created.id })
    .onConflictDoUpdate({
      target: [sharedAccountVoices.accountId, sharedAccountVoices.number],
      set: { personId: created.id },
    });
  return created;
}

/** The participant of a meeting that is this person, made when they are not there yet. */
export async function seatFor(
  db: Writer,
  meetingId: string,
  person: { id: string; name: string; unnamed: boolean },
  tile: { joinedAt: Date | null; leftAt: Date | null },
): Promise<string> {
  const [seat] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(and(eq(participants.meetingId, meetingId), eq(participants.personId, person.id)));
  if (seat) return seat.id;
  const [created] = await db
    .insert(participants)
    .values({
      meetingId,
      displayName: person.name,
      personId: person.id,
      nameConfirmed: !person.unnamed,
      joinedAt: tile.joinedAt,
      leftAt: tile.leftAt,
    })
    .returning({ id: participants.id });
  if (!created) throw new Error('Could not add the person to the meeting');
  return created.id;
}

/**
 * Turns the voices of a tile into people of the meeting. Every voice gets a person (a new unnamed
 * one, or the one made for it before), a seat in the meeting and its lines. Lines the owner set
 * stay as they are, lines that fit no voice stay with the tile and become uncertain. Voices
 * already named keep their person. Call it once the number of people is known.
 */
export async function applyRoomVoices(
  db: Database,
  meetingId: string,
  tileId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [tile] = await tx
      .select()
      .from(participants)
      .where(and(eq(participants.id, tileId), eq(participants.meetingId, meetingId)));
    if (!tile) return 0;
    // Two applies of one account (the summary giving up waiting, the owner answering) at once
    // must not both make "Voice 1".
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${accountKey(tile)}))`);
    const voices = await tx
      .select()
      .from(roomVoices)
      .where(and(eq(roomVoices.participantId, tileId), eq(roomVoices.meetingId, meetingId)))
      .orderBy(asc(roomVoices.number));
    if (voices.length === 0) return 0;
    const account = await ensureAccount(tx, tile);
    for (const voice of voices) {
      const person = voice.personId
        ? await personById(tx, voice.personId)
        : await personForVoice(tx, account, voice.number);
      if (!person) continue;
      const seat = await seatFor(tx, meetingId, person, tile);
      await rememberVoicePrint(tx, account.id, voice.number, voice.centroid);
      await tx
        .update(roomVoices)
        .set({
          personId: person.id,
          namedAt: person.unnamed ? null : (voice.namedAt ?? new Date()),
        })
        .where(eq(roomVoices.id, voice.id));
      await tx
        .update(transcriptSegments)
        .set({
          participantId: seat,
          speakerSource: 'diarization',
          previousParticipantId: tileId,
        })
        .where(
          and(
            eq(transcriptSegments.roomVoiceId, voice.id),
            sql`${transcriptSegments.speakerSource} is distinct from 'user'`,
          ),
        );
    }
    await tx
      .update(transcriptSegments)
      .set({
        speakerConfidence: sql`least(coalesce(${transcriptSegments.speakerConfidence}, 1), ${SUSPECT_CONFIDENCE_CAP})`,
      })
      .where(
        and(
          eq(transcriptSegments.meetingId, meetingId),
          eq(transcriptSegments.participantId, tileId),
          isNull(transcriptSegments.roomVoiceId),
          sql`${transcriptSegments.speakerSource} is distinct from 'user'`,
        ),
      );
    return voices.length;
  });
}

/** The voice prints known for the numbers of an account, to find the same people again. */
export async function accountVoicePrints(
  db: Writer,
  tile: { email: string | null; displayName: string },
): Promise<{ number: number; centroid: number[] | null }[]> {
  return db
    .select({ number: sharedAccountVoices.number, centroid: sharedAccountVoices.centroid })
    .from(sharedAccountVoices)
    .innerJoin(sharedAccounts, eq(sharedAccounts.id, sharedAccountVoices.accountId))
    .where(eq(sharedAccounts.key, accountKey(tile)));
}

/** Keeps how a voice sounded, blended with what was heard before. */
async function rememberVoicePrint(
  db: Writer,
  accountId: string,
  number: number,
  centroid: number[],
): Promise<void> {
  const [row] = await db
    .select({ centroid: sharedAccountVoices.centroid })
    .from(sharedAccountVoices)
    .where(
      and(eq(sharedAccountVoices.accountId, accountId), eq(sharedAccountVoices.number, number)),
    );
  const old = row?.centroid;
  const mixed =
    old && old.length === centroid.length
      ? centroid.map((value, i) => value + (old[i] ?? 0))
      : centroid;
  const length = Math.sqrt(mixed.reduce((sum, value) => sum + value * value, 0)) || 1;
  await db
    .update(sharedAccountVoices)
    .set({ centroid: mixed.map((value) => value / length) })
    .where(
      and(eq(sharedAccountVoices.accountId, accountId), eq(sharedAccountVoices.number, number)),
    );
}

async function personById(db: Writer, id: string) {
  const [person] = await db
    .select({ id: people.id, name: people.name, unnamed: people.unnamed })
    .from(people)
    .where(eq(people.id, id));
  return person;
}

/** A tile whose number of people nobody gave yet, or whose split is being worked on. */
export interface RoomQuestion {
  participantId: string;
  name: string;
  voices: number;
  askedAt: Date;
  /** The owner asked for this many and the voices are not there yet. */
  splitting: boolean;
}

/**
 * The tiles of a meeting the summary should wait for: voices found but "how many people?" not
 * answered, or a split asked for that has not produced voices yet.
 */
export async function openRoomQuestions(db: Writer, meetingId: string): Promise<RoomQuestion[]> {
  const rows = await db
    .select({
      id: participants.id,
      name: participants.displayName,
      askedAt: participants.roomAskedAt,
      count: participants.roomCount,
      voices: sql<number>`count(${roomVoices.id})::int`,
    })
    .from(participants)
    .leftJoin(roomVoices, eq(roomVoices.participantId, participants.id))
    .where(
      and(
        eq(participants.meetingId, meetingId),
        isNull(participants.roomDismissedAt),
        isNotNull(participants.roomAskedAt),
      ),
    )
    .groupBy(participants.id);
  return rows.flatMap((row) => {
    if (!row.askedAt) return [];
    const asking = row.count === null && row.voices > 0;
    const splitting = row.count !== null && row.count >= 2 && row.voices !== row.count;
    return asking || splitting
      ? [
          {
            participantId: row.id,
            name: row.name,
            voices: row.voices,
            askedAt: row.askedAt,
            splitting,
          },
        ]
      : [];
  });
}

/**
 * Gives up waiting: every open question takes the detected number of voices as its answer (not
 * remembered, nobody said it) and the voices become people. A split that never produced voices
 * is cancelled, the tile stays as it was.
 */
export async function settleRoomQuestions(db: Database, meetingId: string): Promise<number> {
  const open = await openRoomQuestions(db, meetingId);
  for (const question of open) {
    if (question.splitting && question.voices === 0) {
      // The split never happened and there is nothing else: the tile stays as it was.
      await db
        .update(participants)
        .set({ roomCount: null, roomAskedAt: null })
        .where(eq(participants.id, question.participantId));
      continue;
    }
    // The voices that were found are the answer, only if nobody answered in the meantime.
    const taken = await db
      .update(participants)
      .set({ roomCount: question.voices, roomAskedAt: null })
      .where(
        and(
          eq(participants.id, question.participantId),
          question.splitting ? isNotNull(participants.roomCount) : isNull(participants.roomCount),
        ),
      )
      .returning({ id: participants.id });
    if (taken.length > 0) await applyRoomVoices(db, meetingId, question.participantId);
  }
  return open.length;
}

/** True for a tile that holds several people: voices found, a count of 2 or more, or a remembered account. */
export async function isSharedTile(
  db: Writer,
  tile: { id: string; email: string | null; displayName: string; roomCount?: number | null },
): Promise<boolean> {
  if ((tile.roomCount ?? 0) >= 2) return true;
  const [voice] = await db
    .select({ id: roomVoices.id })
    .from(roomVoices)
    .where(eq(roomVoices.participantId, tile.id))
    .limit(1);
  if (voice) return true;
  return ((await rememberedCount(db, tile)) ?? 0) >= 2;
}

/**
 * Takes the voices of a tile away again: the lines go back to the tile and the unnamed people
 * made for the voices lose their seat in this meeting when it holds nothing of theirs (no lines,
 * no address). A person is removed only when nothing else is theirs (samples, notes, addresses,
 * invitations, other seats) and their voice number is above `keep`, so a split into fewer
 * people keeps the first ones and "it is one person" (keep 0) removes them all. Named voices are
 * never touched: callers refuse before when one is named.
 */
export async function resetRoomVoices(
  db: Database,
  meetingId: string,
  tileId: string,
  keep = 0,
): Promise<void> {
  await db.transaction(async (tx) => {
    const voices = await tx
      .select()
      .from(roomVoices)
      .where(and(eq(roomVoices.participantId, tileId), eq(roomVoices.meetingId, meetingId)));
    if (voices.length === 0) return;
    await tx
      .update(transcriptSegments)
      .set({ participantId: tileId, speakerSource: 'indicator', previousParticipantId: null })
      .where(
        and(
          inArray(
            transcriptSegments.roomVoiceId,
            voices.map((v) => v.id),
          ),
          sql`${transcriptSegments.speakerSource} is distinct from 'user'`,
        ),
      );
    await tx.delete(roomVoices).where(eq(roomVoices.participantId, tileId));
    const ids = voices.flatMap((v) => (v.personId ? [v.personId] : []));
    if (ids.length === 0) return;
    const unnamed = await tx
      .select({ id: people.id, notes: people.notes, emails: people.emails })
      .from(people)
      .where(and(inArray(people.id, ids), eq(people.unnamed, true)));
    for (const person of unnamed) {
      const seats = await tx
        .select({
          id: participants.id,
          email: participants.email,
          links: participants.inviteeEmails,
        })
        .from(participants)
        .where(and(eq(participants.meetingId, meetingId), eq(participants.personId, person.id)));
      for (const seat of seats) {
        const [used] = await tx
          .select({ id: transcriptSegments.id })
          .from(transcriptSegments)
          .where(eq(transcriptSegments.participantId, seat.id))
          .limit(1);
        if (!used && !seat.email && seat.links.length === 0) {
          await tx.delete(participants).where(eq(participants.id, seat.id));
        }
      }
      const [voice] = await tx
        .select({ number: sharedAccountVoices.number })
        .from(sharedAccountVoices)
        .where(eq(sharedAccountVoices.personId, person.id));
      if (voice && voice.number <= keep) continue;
      const [stillSeated] = await tx
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.personId, person.id))
        .limit(1);
      const [sampled] = await tx
        .select({ id: voiceSamples.id })
        .from(voiceSamples)
        .where(eq(voiceSamples.personId, person.id))
        .limit(1);
      const [invited] = await tx
        .select({ id: meetingInvitees.personId })
        .from(meetingInvitees)
        .where(eq(meetingInvitees.personId, person.id))
        .limit(1);
      const mine = person.emails.length > 0 || !!person.notes;
      if (!stillSeated && !sampled && !invited && !mine) {
        await tx.delete(people).where(eq(people.id, person.id));
      }
    }
  });
}

/**
 * Whether the summary of a meeting has to wait, and for how long at the most. Undefined: go on.
 * `now` is a parameter so the decision is testable.
 */
export function summaryWait(
  questions: readonly RoomQuestion[],
  minutes: number,
  now: Date,
): { until: Date } | undefined {
  if (minutes <= 0 || questions.length === 0) return undefined;
  const until = new Date(Math.min(...questions.map((q) => q.askedAt.getTime())) + minutes * 60_000);
  return until.getTime() > now.getTime() ? { until } : undefined;
}
