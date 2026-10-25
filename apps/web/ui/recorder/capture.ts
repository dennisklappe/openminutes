import { CHUNK_MS, type RecordingClock } from './clock.js';
import { pickMimeType } from './mime.js';
import type { RecorderStore } from './store.js';

export interface Capture {
  readonly mimeType: string;
  begin: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<number>;
  elapsed: () => number;
}

export interface CaptureOptions {
  stream: MediaStream;
  recordingId: string;
  store: RecorderStore;
  clock: RecordingClock;
  onChunkSaved: (count: number) => void;
  onError: (error: Error) => void;
}

function chooseMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return pickMimeType((type) => MediaRecorder.isTypeSupported(type));
}

export function prepareCapture(options: CaptureOptions): Capture {
  const { stream, recordingId, store, clock } = options;
  const mimeType = chooseMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  let saved = 0;
  let persisted: Promise<void> = Promise.resolve();

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    const index = saved++;
    persisted = persisted
      .then(async () => {
        await store.putChunk({ recordingId, index, blob: event.data, uploaded: false });
        await store.updateRecording(recordingId, {
          chunkCount: index + 1,
          durationMs: clock.elapsed(Date.now()),
        });
        options.onChunkSaved(index + 1);
      })
      .catch((error: unknown) => {
        options.onError(error instanceof Error ? error : new Error('Saving audio failed'));
      });
  };

  return {
    mimeType: recorder.mimeType || mimeType || '',
    begin: () => {
      clock.start(Date.now());
      recorder.start(CHUNK_MS);
    },
    pause: () => {
      recorder.pause();
      clock.pause(Date.now());
    },
    resume: () => {
      recorder.resume();
      clock.start(Date.now());
    },
    elapsed: () => clock.elapsed(Date.now()),
    stop: async () => {
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => {
          resolve();
        };
      });
      clock.pause(Date.now());
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      await persisted;
      for (const track of stream.getTracks()) track.stop();
      return saved;
    },
  };
}
