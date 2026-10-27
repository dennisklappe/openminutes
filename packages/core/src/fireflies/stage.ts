import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ChunkStore } from '../chunk-store.js';
import type { LocalStorage } from '../storage.js';
import { extractExport, type ExtractLimits } from './extract.js';
import { readFirefliesMeeting } from './parse.js';

const stagedMeeting = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: z.string(),
  durationMs: z.number(),
  attendees: z.number(),
  hasAudio: z.boolean(),
});
const manifestSchema = z.object({ meetings: z.array(stagedMeeting), unreadable: z.number() });

export type StagedMeeting = z.infer<typeof stagedMeeting>;
export type StagedExport = z.infer<typeof manifestSchema>;

const UPLOAD = 'upload.bin';
const MANIFEST = 'manifest.json';
const MEETINGS = 'meetings';

export const importFolder = (uploadId: string) => `imports/${uploadId}`;
export const stagedMeetingFolder = (uploadId: string, id: string) =>
  `${importFolder(uploadId)}/${MEETINGS}/${id}`;
export const importChunks = (storage: LocalStorage, uploadId: string, maxBytes: number) =>
  new ChunkStore(storage, `${importFolder(uploadId)}/chunks`, maxBytes);
export const uploadPath = (uploadId: string) => `${importFolder(uploadId)}/${UPLOAD}`;

export async function loadStaged(
  storage: LocalStorage,
  uploadId: string,
): Promise<StagedExport | undefined> {
  try {
    const chunks: Buffer[] = [];
    for await (const part of storage.read(`${importFolder(uploadId)}/${MANIFEST}`)) {
      chunks.push(part as Buffer);
    }
    return manifestSchema.parse(JSON.parse(Buffer.concat(chunks).toString()));
  } catch {
    return undefined;
  }
}

/**
 * Unpacks the uploaded archive and writes the list of meetings it holds next to them. The archive
 * itself is removed. A meeting folder that cannot be read is dropped and counted.
 */
export async function stageExport(
  storage: LocalStorage,
  uploadId: string,
  limits: ExtractLimits,
): Promise<StagedExport> {
  const meetingsRoot = await storage.ensureDirectory(`${importFolder(uploadId)}/${MEETINGS}`);
  try {
    const ids = await extractExport(
      storage.absolutePath(uploadPath(uploadId)),
      meetingsRoot,
      limits,
    );
    const meetings: StagedMeeting[] = [];
    let unreadable = 0;
    for (const id of ids) {
      try {
        const meeting = await readFirefliesMeeting(join(meetingsRoot, id), id);
        meetings.push({
          id,
          title: meeting.title,
          startedAt: meeting.startedAt.toISOString(),
          durationMs: meeting.durationMs,
          attendees: meeting.attendees.length,
          hasAudio: meeting.hasAudio,
        });
      } catch {
        unreadable++;
        await rm(join(meetingsRoot, id), { recursive: true, force: true });
      }
    }
    meetings.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const staged = { meetings, unreadable };
    await storage.write(
      `${importFolder(uploadId)}/${MANIFEST}`,
      new TextEncoder().encode(JSON.stringify(staged)),
    );
    return staged;
  } catch (error) {
    await removeImport(storage, uploadId);
    throw error;
  } finally {
    await storage.remove(uploadPath(uploadId));
  }
}

export const removeStagedMeeting = (storage: LocalStorage, uploadId: string, id: string) =>
  storage.removeDirectory(stagedMeetingFolder(uploadId, id));

export const removeImport = (storage: LocalStorage, uploadId: string) =>
  storage.removeDirectory(importFolder(uploadId));

export async function removeStaleImports(
  storage: LocalStorage,
  olderThanMs: number,
  now: Date,
): Promise<number> {
  const root = storage.absolutePath('imports');
  const names = await readdir(root).catch(() => []);
  let removed = 0;
  for (const name of names) {
    const { mtimeMs } = await stat(join(root, name));
    if (now.getTime() - mtimeMs > olderThanMs) {
      await rm(join(root, name), { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
