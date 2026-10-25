import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  meetingExports,
  meetings,
  notInArray,
  shareLinks,
  sql,
  type Database,
  type MeetingStatus,
} from '@openminutes/db';
import { removeAudio } from './audio-files.js';
import type { AudioStorage } from './audio-storage.js';

export const BIN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const IN_PROGRESS: MeetingStatus[] = [
  'uploading',
  'joining',
  'in_lobby',
  'recording',
  'processing',
];

export const binExpiry = (deletedAt: Date): Date =>
  new Date(deletedAt.getTime() + BIN_DAYS * DAY_MS);

/** A meeting can be archived or binned once it is over: not in progress and not upcoming. */
const settled = (now: Date) =>
  and(
    notInArray(meetings.status, IN_PROGRESS),
    sql`not (${meetings.status} = 'scheduled' or (${meetings.status} = 'skipped' and (${meetings.scheduledStart} is null or ${meetings.scheduledStart} > ${now.toISOString()}::timestamptz)))`,
  );

export const isSettled = (
  meeting: Pick<typeof meetings.$inferSelect, 'status' | 'scheduledStart'>,
  now: Date,
): boolean => {
  if (meeting.status === 'scheduled') return false;
  if (meeting.status === 'skipped') {
    return meeting.scheduledStart !== null && meeting.scheduledStart <= now;
  }
  return !IN_PROGRESS.includes(meeting.status);
};

async function setFlag(
  db: Pick<Database, 'update'>,
  ids: readonly string[],
  set: Partial<Pick<typeof meetings.$inferInsert, 'archivedAt' | 'deletedAt'>>,
  where: ReturnType<typeof and>,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(meetings)
    .set(set)
    .where(and(inArray(meetings.id, [...ids]), where))
    .returning({ id: meetings.id });
  return rows.map((row) => row.id);
}

export const archiveMeetings = (db: Database, ids: readonly string[], now: Date) =>
  setFlag(
    db,
    ids,
    { archivedAt: now },
    and(isNull(meetings.archivedAt), isNull(meetings.deletedAt), settled(now)),
  );

export const unarchiveMeetings = (db: Database, ids: readonly string[]) =>
  setFlag(db, ids, { archivedAt: null }, isNotNull(meetings.archivedAt));

/** Moves meetings to the bin and revokes their share links right away. */
export async function binMeetings(
  db: Database,
  ids: readonly string[],
  now: Date,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const binned = await setFlag(
      tx,
      ids,
      { deletedAt: now },
      and(isNull(meetings.deletedAt), settled(now)),
    );
    if (binned.length === 0) return binned;
    await tx
      .update(shareLinks)
      .set({ revokedAt: now })
      .where(and(inArray(shareLinks.meetingId, binned), isNull(shareLinks.revokedAt)));
    await tx
      .delete(meetingExports)
      .where(
        and(inArray(meetingExports.meetingId, binned), eq(meetingExports.exporterId, 'share-link')),
      );
    return binned;
  });
}

export const restoreMeetings = (db: Database, ids: readonly string[]) =>
  setFlag(db, ids, { deletedAt: null }, isNotNull(meetings.deletedAt));

interface PurgeDeps {
  db: Database;
  storage: AudioStorage;
}

/** Permanently removes binned meetings with their audio, transcript, summaries and links. */
export async function purgeMeetings(deps: PurgeDeps, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const binned = await deps.db
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(inArray(meetings.id, [...ids]), isNotNull(meetings.deletedAt)));
  for (const { id } of binned) {
    await removeAudio(deps.db, deps.storage, id);
    await deps.db.delete(meetings).where(eq(meetings.id, id));
  }
  return binned.map((row) => row.id);
}

export async function purgeExpiredBin(deps: PurgeDeps & { now: Date }): Promise<number> {
  const cutoff = new Date(deps.now.getTime() - BIN_DAYS * DAY_MS);
  const expired = await deps.db
    .select({ id: meetings.id })
    .from(meetings)
    .where(lte(meetings.deletedAt, cutoff));
  const purged = await purgeMeetings(
    deps,
    expired.map((row) => row.id),
  );
  return purged.length;
}
