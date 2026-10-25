import { eq, meetings, type Database } from '@openminutes/db';
import { joinJobExpirySeconds, type JobSender, type SettingsStore } from '@openminutes/core';

const JOIN_LEAD_MS = 60_000;

export async function scheduleMeeting(
  deps: { db: Database; queue: JobSender; settings: SettingsStore; now?: () => Date },
  meetingId: string,
): Promise<void> {
  const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (meeting?.status !== 'scheduled') return;

  const now = (deps.now ?? (() => new Date()))();
  const joinAt = meeting.scheduledStart
    ? new Date(meeting.scheduledStart.getTime() - JOIN_LEAD_MS)
    : now;
  const lobbySeconds = await deps.settings.getNumber('bot.lobby_timeout_seconds');
  const maxMinutes = await deps.settings.getNumber('bot.max_duration_minutes');

  await deps.queue.send(
    'meeting.join',
    { meetingId, scheduledStart: meeting.scheduledStart?.toISOString() ?? null },
    {
      ...(joinAt > now && { startAfter: joinAt }),
      expireInSeconds: joinJobExpirySeconds(lobbySeconds, maxMinutes),
      retryLimit: 0,
    },
  );
}
