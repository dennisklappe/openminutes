import {
  and,
  eq,
  inArray,
  lt,
  meetings,
  or,
  sql,
  type Database,
  type MeetingStatus,
} from '@openminutes/db';

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_STALE_MS = 90_000;
export const PROCESSING_STALE_MS = 600_000;
export const JOIN_GRACE_MS = 120_000;
export const RECORDING_GRACE_MS = 600_000;

const JOINING: readonly MeetingStatus[] = ['joining', 'in_lobby'];

export const lobbyTimeoutMessage = (lobbyTimeoutSeconds: number): string => {
  const minutes = Math.max(1, Math.round(lobbyTimeoutSeconds / 60));
  return `Nobody admitted the bot within ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}`;
};

export interface WatchdogLimits {
  lobbyTimeoutSeconds: number;
  maxDurationMinutes: number;
}

export interface StuckMeeting {
  id: string;
  reason: 'lobby' | 'heartbeat' | 'duration' | 'processing';
}

const STOPPED_ERROR =
  'The bot stopped responding. Audio recorded so far is kept, press Transcribe to use it.';

const INTERRUPTED_ERROR =
  'Processing was interrupted, probably by a restart. Press Re-process to try again.';

/** Fails every active meeting that outlived its limits, no matter whether the bot process is still alive. */
export async function failStuckMeetings(
  db: Database,
  limits: WatchdogLimits,
  now: Date = new Date(),
): Promise<StuckMeeting[]> {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const joinDeadline = ago(limits.lobbyTimeoutSeconds * 1000 + JOIN_GRACE_MS);
  const durationDeadline = ago(limits.maxDurationMinutes * 60_000 + RECORDING_GRACE_MS);
  const lastSignal = sql`coalesce(${meetings.heartbeatAt}, ${meetings.claimedAt}, ${meetings.startedAt}, ${meetings.createdAt})`;
  const failed: StuckMeeting[] = [];

  const fail = async (
    reason: StuckMeeting['reason'],
    condition: ReturnType<typeof and>,
    error: string,
  ) => {
    const rows = await db
      .update(meetings)
      .set({
        status: 'failed',
        endedAt: sql`coalesce(${meetings.endedAt}, ${now.toISOString()})`,
        error,
      })
      .where(condition)
      .returning({ id: meetings.id });
    failed.push(...rows.map(({ id }) => ({ id, reason })));
  };

  await fail(
    'lobby',
    and(
      inArray(meetings.status, JOINING),
      lt(sql`coalesce(${meetings.claimedAt}, ${meetings.createdAt})`, joinDeadline),
    ),
    lobbyTimeoutMessage(limits.lobbyTimeoutSeconds),
  );
  await fail(
    'duration',
    and(
      eq(meetings.status, 'recording'),
      lt(sql`coalesce(${meetings.startedAt}, ${meetings.createdAt})`, durationDeadline),
    ),
    'The meeting ran past the maximum duration and was closed. Audio recorded so far is kept, press Transcribe to use it.',
  );
  await fail(
    'heartbeat',
    and(
      or(inArray(meetings.status, JOINING), eq(meetings.status, 'recording')),
      lt(lastSignal, ago(HEARTBEAT_STALE_MS)),
    ),
    STOPPED_ERROR,
  );
  await fail(
    'processing',
    and(
      eq(meetings.status, 'processing'),
      lt(
        sql`coalesce(${meetings.heartbeatAt}, ${meetings.processingStartedAt}, ${meetings.createdAt})`,
        ago(PROCESSING_STALE_MS),
      ),
    ),
    INTERRUPTED_ERROR,
  );
  return failed;
}
