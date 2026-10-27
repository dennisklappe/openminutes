import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { meetingFolder, type AudioStorage } from '@openminutes/core';
import { audioFiles, eq, type Database } from '@openminutes/db';
import type { ProbeDuration } from './probe-duration.js';

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Moves the audio of the export into the meeting's folder and records it, so the normal
 * processing can transcribe it. A second run finds the audio in place and records it again.
 */
export async function storeImportedAudio(
  deps: { db: Database; probeDuration: ProbeDuration },
  storage: AudioStorage,
  meetingId: string,
  staged: string,
): Promise<void> {
  const path = `${meetingFolder(meetingId)}/recording.mp3`;
  const target = storage.local.absolutePath(path);
  if (await exists(staged)) {
    await mkdir(dirname(target), { recursive: true });
    await rename(staged, target);
  }
  if (!(await exists(target))) throw new Error('The audio of this meeting is no longer there');
  const [durationMs, { size }] = await Promise.all([deps.probeDuration(target), stat(target)]);
  await deps.db.transaction(async (tx) => {
    await tx.delete(audioFiles).where(eq(audioFiles.meetingId, meetingId));
    await tx.insert(audioFiles).values({ meetingId, path, durationMs, codec: 'mp3', size });
  });
}
