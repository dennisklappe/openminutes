import { uuid } from '../uuid.js';
import { RecordingClock, missingChunks } from './clock.js';
import { createRecordingsClient } from './client.js';
import { prepareCapture, type Capture } from './capture.js';
import { openMicrophone } from './microphone.js';
import { discardRecording, findUnfinished, sealForUpload, type Unfinished } from './recovery.js';
import { UploadRunner } from './runner.js';
import { openRecorderDb, RecorderStore } from './store.js';
import { ScreenWakeLock, type WakeLockHost, type WakeLockState } from './wakeLock.js';

export type Phase =
  'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'uploading' | 'done' | 'failed';

export interface SessionSnapshot {
  phase: Phase;
  recordingId: string | undefined;
  meetingId: string | undefined;
  chunks: number;
  uploaded: number;
  waiting: boolean;
  error: string | undefined;
  wakeLock: WakeLockState;
  wasHidden: boolean;
  unfinished: Unfinished[];
}

const idle: SessionSnapshot = {
  phase: 'idle',
  recordingId: undefined,
  meetingId: undefined,
  error: undefined,
  chunks: 0,
  uploaded: 0,
  waiting: false,
  wakeLock: 'idle',
  wasHidden: false,
  unfinished: [],
};

const ACTIVE: Phase[] = ['recording', 'paused'];

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Recording failed');

const keepOpen = (event: BeforeUnloadEvent) => {
  event.preventDefault();
};

class RecorderSession {
  private snapshot: SessionSnapshot = idle;
  private readonly listeners = new Set<() => void>();
  private storePromise: Promise<RecorderStore> | undefined;
  private runner: UploadRunner | undefined;
  private capture: Capture | undefined;
  private clock = new RecordingClock();
  private wakeLock: ScreenWakeLock | undefined;
  private audio: AudioContext | undefined;
  analyser: AnalyserNode | undefined;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  elapsed = () => this.clock.elapsed(Date.now());

  hasGap = () =>
    ACTIVE.includes(this.snapshot.phase) && missingChunks(this.elapsed(), this.snapshot.chunks);

  private set(patch: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private store(): Promise<RecorderStore> {
    this.storePromise ??= openRecorderDb().then((db) => new RecorderStore(db));
    return this.storePromise;
  }

  private async uploads(): Promise<UploadRunner> {
    const store = await this.store();
    this.runner ??= new UploadRunner(store, (progress) => {
      this.set({
        uploaded: progress.uploaded,
        waiting: progress.waiting,
        error: progress.error,
      });
    });
    return this.runner;
  }

  async refreshUnfinished(): Promise<void> {
    try {
      const store = await this.store();
      const active = ACTIVE.includes(this.snapshot.phase) || this.snapshot.phase === 'uploading';
      this.set({
        unfinished: await findUnfinished(store, active ? this.snapshot.recordingId : undefined),
      });
    } catch {
      this.set({ unfinished: [] });
    }
  }

  async start(speakers?: number): Promise<void> {
    if (
      this.snapshot.phase !== 'idle' &&
      this.snapshot.phase !== 'done' &&
      this.snapshot.phase !== 'failed'
    )
      return;
    this.set({ ...idle, phase: 'starting', unfinished: this.snapshot.unfinished });
    let stream: MediaStream | undefined;
    try {
      stream = await openMicrophone();
      const store = await this.store();
      const runner = await this.uploads();
      const id = uuid();
      this.clock = new RecordingClock();
      const capture = prepareCapture({
        stream,
        recordingId: id,
        store,
        clock: this.clock,
        onChunkSaved: (chunks) => {
          this.set({ chunks });
          void runner.kick(id).then(
            () => undefined,
            (error: unknown) => {
              this.uploadFailed(error);
            },
          );
        },
        onError: (error) => {
          this.set({ error: error.message });
        },
      });
      await store.putRecording({
        id,
        mimeType: capture.mimeType,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        state: 'recording',
        chunkCount: 0,
        uploadedCount: 0,
        ...(speakers && { speakers }),
      });
      this.attachAudio(stream);
      this.capture = capture;
      capture.begin();
      await this.holdScreen();
      window.addEventListener('beforeunload', keepOpen);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.set({ phase: 'recording', recordingId: id });
    } catch (error) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      this.fail(error);
    }
  }

  private attachAudio(stream: MediaStream) {
    this.audio = new AudioContext();
    // Safari starts a context created after an await suspended; the meter would stay flat.
    void this.audio.resume().catch(() => undefined);
    this.analyser = this.audio.createAnalyser();
    this.analyser.fftSize = 512;
    this.audio.createMediaStreamSource(stream).connect(this.analyser);
  }

  private async holdScreen() {
    const host = 'wakeLock' in navigator ? (navigator.wakeLock as WakeLockHost) : undefined;
    this.wakeLock = new ScreenWakeLock(host, (wakeLock) => {
      this.set({ wakeLock });
    });
    await this.wakeLock.acquire();
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (ACTIVE.includes(this.snapshot.phase)) this.set({ wasHidden: true });
    } else {
      void this.wakeLock?.reacquire();
    }
  };

  pause() {
    if (this.snapshot.phase !== 'recording') return;
    this.capture?.pause();
    this.set({ phase: 'paused' });
  }

  resume() {
    if (this.snapshot.phase !== 'paused') return;
    this.capture?.resume();
    this.set({ phase: 'recording' });
  }

  async stop(): Promise<void> {
    const { capture } = this;
    const id = this.snapshot.recordingId;
    if (!capture || !id || !ACTIVE.includes(this.snapshot.phase)) return;
    this.set({ phase: 'stopping' });
    try {
      const durationMs = capture.elapsed();
      const chunkCount = await capture.stop();
      const store = await this.store();
      await store.updateRecording(id, { state: 'stopped', chunkCount, durationMs });
      this.teardown();
      this.set({ phase: 'uploading', chunks: chunkCount });
      await this.upload(id);
    } catch (error) {
      this.teardown();
      this.fail(error);
    }
  }

  async upload(id: string): Promise<void> {
    const runner = await this.uploads();
    try {
      const result = await runner.kick(id);
      if (result.kind === 'done') {
        this.set({ phase: 'done', meetingId: result.status.id });
      }
    } catch (error) {
      this.uploadFailed(error);
    }
  }

  async resumeUnfinished(id: string): Promise<void> {
    const store = await this.store();
    await sealForUpload(store, id);
    this.set({ phase: 'uploading', recordingId: id });
    await this.upload(id);
    await this.refreshUnfinished();
  }

  async discardUnfinished(id: string): Promise<void> {
    await discardRecording(await this.store(), createRecordingsClient(), id);
    await this.refreshUnfinished();
  }

  private teardown() {
    window.removeEventListener('beforeunload', keepOpen);
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.wakeLock?.release();
    void this.audio?.close();
    this.audio = undefined;
    this.analyser = undefined;
    this.capture = undefined;
  }

  private uploadFailed(error: unknown) {
    if (ACTIVE.includes(this.snapshot.phase)) this.set({ error: errorText(error) });
    else this.fail(error);
  }

  private fail(error: unknown) {
    this.set({ phase: 'failed', error: errorText(error) });
    void this.refreshUnfinished();
  }

  reset() {
    if (this.snapshot.phase === 'done' || this.snapshot.phase === 'failed') {
      this.clock = new RecordingClock();
      this.set({ ...idle, unfinished: this.snapshot.unfinished });
    }
  }
}

export const recorderSession = new RecorderSession();
