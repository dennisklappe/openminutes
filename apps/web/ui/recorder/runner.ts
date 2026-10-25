import { createRecordingsClient, type RecordingsClient } from './client.js';
import type { RecorderStore } from './store.js';
import { syncRecording, type SyncResult, type UploadProgress } from './uploader.js';

function onlineSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener('online', finish);
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      window.removeEventListener('online', finish);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(finish, ms);
    window.addEventListener('online', finish, { once: true });
    signal.addEventListener('abort', abort, { once: true });
  });
}

export class UploadRunner {
  private running: Promise<SyncResult> | undefined;
  private again = false;
  private controller = new AbortController();

  constructor(
    private readonly store: RecorderStore,
    private readonly onProgress: (progress: UploadProgress) => void,
    private readonly client: RecordingsClient = createRecordingsClient(),
  ) {}

  kick(id: string): Promise<SyncResult> {
    this.again = true;
    this.running ??= this.loop(id);
    return this.running;
  }

  abort(): void {
    this.controller.abort();
    this.controller = new AbortController();
  }

  private async loop(id: string): Promise<SyncResult> {
    let result: SyncResult = { kind: 'idle' };
    try {
      while (this.again) {
        this.again = false;
        result = await syncRecording(id, {
          store: this.store,
          client: this.client,
          sleep: onlineSleep,
          signal: this.controller.signal,
          onProgress: this.onProgress,
        });
        if (result.kind === 'done') this.again = false;
      }
      return result;
    } finally {
      this.running = undefined;
    }
  }
}
