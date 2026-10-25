import { formatLength } from '../format.js';
import type { RecordingsClient } from './client.js';
import type { LocalRecording, RecorderStore } from './store.js';

export interface Unfinished {
  id: string;
  label: string;
}

export function describeUnfinished(recording: LocalRecording): string {
  const time = new Date(recording.startedAt).toLocaleTimeString(undefined, { timeStyle: 'short' });
  const length =
    recording.durationMs >= 1000 ? formatLength(recording.durationMs) : 'under a second';
  return `${time}, ${length}`;
}

export async function findUnfinished(
  store: RecorderStore,
  activeId: string | undefined,
): Promise<Unfinished[]> {
  const others = (await store.listRecordings()).filter((recording) => recording.id !== activeId);
  for (const empty of others.filter((recording) => recording.chunkCount === 0)) {
    await store.deleteRecording(empty.id);
  }
  return others
    .filter((recording) => recording.chunkCount > 0)
    .map((recording) => ({ id: recording.id, label: describeUnfinished(recording) }));
}

export async function sealForUpload(store: RecorderStore, id: string): Promise<void> {
  const recording = await store.getRecording(id);
  if (recording?.state !== 'recording') return;
  const chunks = await store.listChunks(id);
  await store.updateRecording(id, { state: 'stopped', chunkCount: chunks.length });
}

export async function discardRecording(
  store: RecorderStore,
  client: RecordingsClient,
  id: string,
): Promise<void> {
  await store.deleteRecording(id);
  await client.discard(id).catch(() => undefined);
}
