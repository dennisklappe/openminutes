import {
  loadAudioStorage,
  removeAudio,
  type LocalStorage,
  type SettingsStore,
} from '@openminutes/core';
import { and, audioFiles, eq, exists, lt, meetings, ne, sql, type Database } from '@openminutes/db';

const DAY_MS = 24 * 60 * 60 * 1000;

interface RetentionDeps {
  db: Database;
  settings: SettingsStore;
  local: LocalStorage;
  now?: () => Date;
}

export async function deleteExpiredAudio(deps: RetentionDeps): Promise<number> {
  const days = await deps.settings.get('retention.audio_days');
  if (days === undefined) return 0;

  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - Number(days) * DAY_MS);
  const expired = await deps.db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        lt(meetings.endedAt, cutoff),
        ne(meetings.status, 'processing'),
        exists(
          deps.db
            .select({ one: sql`1` })
            .from(audioFiles)
            .where(eq(audioFiles.meetingId, meetings.id)),
        ),
      ),
    );

  const storage = await loadAudioStorage(deps.settings, deps.local);
  for (const { id } of expired) {
    await removeAudio(deps.db, storage, id);
    await deps.db.update(meetings).set({ audioDeletedAt: now }).where(eq(meetings.id, id));
  }
  return expired.length;
}
