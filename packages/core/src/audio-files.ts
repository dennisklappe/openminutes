import { audioFiles, eq, type Database } from '@openminutes/db';
import { meetingFolder, mergedAudioPath, originalAudioPath } from './audio-paths.js';
import type { AudioStorage } from './audio-storage.js';

async function audioPaths(db: Database, meetingId: string): Promise<string[]> {
  const rows = await db
    .select({ path: audioFiles.path })
    .from(audioFiles)
    .where(eq(audioFiles.meetingId, meetingId));
  return [...rows.map((row) => row.path), mergedAudioPath(meetingId)];
}

export async function archiveAudio(
  db: Database,
  storage: AudioStorage,
  meetingId: string,
): Promise<void> {
  for (const path of await audioPaths(db, meetingId)) await storage.archive(path);
}

export async function removeAudio(
  db: Database,
  storage: AudioStorage,
  meetingId: string,
): Promise<void> {
  const paths = [...(await audioPaths(db, meetingId)), originalAudioPath(meetingId)];
  for (const path of paths) await storage.remove(path);
  await storage.removeFolder(meetingFolder(meetingId));
  await db.delete(audioFiles).where(eq(audioFiles.meetingId, meetingId));
}
