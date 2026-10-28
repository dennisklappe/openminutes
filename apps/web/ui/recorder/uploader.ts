import type { RecordingStatusDto } from '../../src/dto.js';
import { HttpError, missingFrom, NetworkError, type RecordingsClient } from './client.js';
import type { LocalRecording, RecorderStore } from './store.js';

export interface UploadDeps {
  store: RecorderStore;
  client: RecordingsClient;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  concurrency?: number;
  onProgress?: (progress: UploadProgress) => void;
}

export interface UploadProgress {
  uploaded: number;
  waiting: boolean;
  error?: string;
}

export type SyncResult =
  { kind: 'idle' } | { kind: 'gone' } | { kind: 'done'; status: RecordingStatusDto };

export class UploadFailure extends Error {}

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const FINISH_ATTEMPTS = 3;

export const backoffDelay = (attempt: number) =>
  Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);

const retryable = (error: unknown) =>
  error instanceof NetworkError ||
  (error instanceof HttpError &&
    (error.status >= 500 || error.status === 408 || error.status === 429));

async function withRetry<T>(deps: UploadDeps, uploaded: () => number, action: () => Promise<T>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (deps.signal.aborted || !retryable(error)) throw error;
      deps.onProgress?.({
        uploaded: uploaded(),
        waiting: true,
        error: error instanceof Error ? error.message : 'Upload failed',
      });
      await deps.sleep(backoffDelay(attempt), deps.signal);
    }
  }
}

export async function syncRecording(id: string, deps: UploadDeps): Promise<SyncResult> {
  const { store, client } = deps;
  const first = await store.getRecording(id);
  if (!first) return { kind: 'gone' };

  let uploadedCount = first.uploadedCount;
  const report = () => {
    deps.onProgress?.({ uploaded: uploadedCount, waiting: false });
  };
  const retry = <T>(action: () => Promise<T>) => withRetry(deps, () => uploadedCount, action);

  const status = await retry(() =>
    client.start({
      id,
      mimeType: first.mimeType,
      startedAt: first.startedAt,
      ...(first.speakers && { speakers: first.speakers }),
      ...(first.eventId && { eventId: first.eventId }),
    }),
  );
  if (status.status !== 'uploading') {
    await store.deleteRecording(id);
    return { kind: 'done', status };
  }
  const onServer = new Set(status.received);

  const upload = async (index: number) => {
    const chunk = await store.getChunk(id, index);
    if (!chunk) throw new UploadFailure(`Chunk ${String(index)} is missing on this device`);
    await retry(() => client.putChunk(id, index, chunk.blob));
  };
  const acknowledge = async (index: number) => {
    onServer.add(index);
    await store.markUploaded(id, index);
    uploadedCount += 1;
    await store.updateRecording(id, { uploadedCount });
    report();
  };

  const pendingChunks = async () =>
    (await store.listChunks(id)).filter((chunk) => !chunk.uploaded).map((chunk) => chunk.index);

  for (let pending = await pendingChunks(); pending.length > 0; pending = await pendingChunks()) {
    const queue = pending.toSorted((a, b) => a - b);
    const worker = async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if (!onServer.has(next)) await upload(next);
        await acknowledge(next);
      }
    };
    await Promise.all(Array.from({ length: deps.concurrency ?? 2 }, worker));
  }

  const recording = await store.getRecording(id);
  if (recording?.state !== 'stopped' || recording.uploadedCount < recording.chunkCount) {
    return { kind: 'idle' };
  }
  return finishRecording(recording, deps, retry, upload);
}

async function finishRecording(
  recording: LocalRecording,
  deps: UploadDeps,
  retry: <T>(action: () => Promise<T>) => Promise<T>,
  upload: (index: number) => Promise<void>,
): Promise<SyncResult> {
  const input = { chunks: recording.chunkCount, durationMs: recording.durationMs };
  for (let attempt = 1; ; attempt++) {
    try {
      const status = await retry(() => deps.client.finish(recording.id, input));
      await deps.store.deleteRecording(recording.id);
      return { kind: 'done', status };
    } catch (error) {
      const missing = missingFrom(error);
      if (!missing || attempt >= FINISH_ATTEMPTS) throw error;
      for (const index of missing) await upload(index);
    }
  }
}
