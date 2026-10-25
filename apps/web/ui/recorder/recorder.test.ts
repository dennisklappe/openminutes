import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingClock, missingChunks } from './clock.js';
import { createRecordingsClient, HttpError, missingFrom, NetworkError } from './client.js';
import { pickMimeType } from './mime.js';
import { describeMicrophoneError, openMicrophone } from './microphone.js';
import { describeUnfinished, discardRecording, findUnfinished, sealForUpload } from './recovery.js';
import { openRecorderDb, RecorderStore, type LocalRecording } from './store.js';
import { FakeServer, offline, serverError } from './testing/fakeServer.js';
import { backoffDelay, syncRecording, UploadFailure, type UploadDeps } from './uploader.js';
import { ScreenWakeLock } from './wakeLock.js';

describe('mime selection', () => {
  it('prefers webm, then mp4, then ogg', () => {
    const all = () => true;
    expect(pickMimeType(all)).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMimeType((type) => type.startsWith('audio/ogg'))).toBe('audio/ogg;codecs=opus');
  });

  it('returns nothing when no type is supported so the browser default is used', () => {
    expect(pickMimeType(() => false)).toBeUndefined();
  });
});

describe('recording clock', () => {
  it('excludes paused time', () => {
    const clock = new RecordingClock();
    clock.start(1000);
    expect(clock.elapsed(4000)).toBe(3000);
    clock.pause(4000);
    expect(clock.elapsed(60_000)).toBe(3000);
    clock.start(60_000);
    clock.start(61_000);
    expect(clock.elapsed(62_000)).toBe(5000);
  });

  it('flags audio that falls behind the clock', () => {
    expect(missingChunks(30_000, 6)).toBe(false);
    expect(missingChunks(30_000, 5)).toBe(false);
    expect(missingChunks(60_000, 6)).toBe(true);
  });
});

describe('screen wake lock', () => {
  const sentinel = () => {
    let onRelease = () => {
      // set once the lock registers its listener
    };
    return {
      release: vi.fn(() => Promise.resolve()),
      addEventListener: (_type: 'release', listener: () => void) => {
        onRelease = listener;
      },
      fire: () => {
        onRelease();
      },
    };
  };

  it('reports unsupported without the API', async () => {
    const lock = new ScreenWakeLock(undefined);
    await lock.acquire();
    expect(lock.state).toBe('unsupported');
  });

  it('reports refused when the request throws', async () => {
    const lock = new ScreenWakeLock({ request: () => Promise.reject(new Error('denied')) });
    await lock.acquire();
    expect(lock.state).toBe('refused');
  });

  it('re-acquires after the system releases it, and not after release()', async () => {
    const made: ReturnType<typeof sentinel>[] = [];
    const request = vi.fn(() => {
      const next = sentinel();
      made.push(next);
      return Promise.resolve(next);
    });
    const lock = new ScreenWakeLock({ request });
    await lock.acquire();
    expect(lock.state).toBe('held');
    made[0]?.fire();
    expect(lock.state).toBe('idle');
    await lock.reacquire();
    expect(request).toHaveBeenCalledTimes(2);
    await lock.release();
    await lock.reacquire();
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('microphone errors', () => {
  it('asks for HTTPS on an insecure page', () => {
    expect(describeMicrophoneError(undefined, false)).toContain('HTTPS');
  });

  it('explains a blocked microphone', () => {
    expect(describeMicrophoneError(new DOMException('x', 'NotAllowedError'), true)).toContain(
      'blocked',
    );
  });
});

describe('opening the microphone', () => {
  it('says plainly when the browser has no MediaRecorder', async () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { mediaDevices: {} });
    vi.stubGlobal('MediaRecorder', undefined);
    await expect(openMicrophone()).rejects.toThrow('cannot record audio');
    vi.unstubAllGlobals();
  });
});

describe('recordings client', () => {
  it('reads the missing list from a 409', async () => {
    const client = createRecordingsClient(() =>
      Promise.resolve(Response.json({ error: 'Missing', missing: [2, 5] }, { status: 409 })),
    );
    const error = await client.finish('r', { chunks: 6, durationMs: 1 }).catch((e: unknown) => e);
    expect(missingFrom(error)).toEqual([2, 5]);
  });

  it('turns a failed fetch into a network error', async () => {
    const client = createRecordingsClient(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(client.status('r')).rejects.toBeInstanceOf(NetworkError);
  });

  it('sends the chunk as the raw body', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    const blob = new Blob(['abc']);
    await createRecordingsClient(fetcher).putChunk('r', 3, blob);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/recordings/r/chunks/3',
      expect.objectContaining({ method: 'PUT', body: blob, credentials: 'same-origin' }),
    );
  });
});

describe('local recording and upload', () => {
  let store: RecorderStore;
  let server: FakeServer;
  let sleeps: number[];
  const controller = new AbortController();
  const deps = (): UploadDeps => ({
    store,
    client: server,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    signal: controller.signal,
  });

  beforeEach(async () => {
    indexedDB = new IDBFactory();
    store = new RecorderStore(await openRecorderDb());
    server = new FakeServer();
    sleeps = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps chunk bytes and type through IndexedDB', async () => {
    await store.putChunk({
      recordingId: 'r',
      index: 0,
      blob: new Blob(['moov'], { type: 'audio/mp4' }),
      uploaded: false,
    });
    await store.markUploaded('r', 0);
    const chunk = await store.getChunk('r', 0);
    expect(chunk?.uploaded).toBe(true);
    expect(chunk?.blob.type).toBe('audio/mp4');
    expect(await chunk?.blob.text()).toBe('moov');
  });

  const record = async (id: string, chunks: number, state: 'recording' | 'stopped' = 'stopped') => {
    await store.putRecording({
      id,
      mimeType: 'audio/webm',
      startedAt: '2026-10-22T12:03:00.000Z',
      durationMs: 480_000,
      state,
      chunkCount: chunks,
      uploadedCount: 0,
    });
    for (let index = 0; index < chunks; index++) {
      await store.putChunk({
        recordingId: id,
        index,
        blob: new Blob([`c${String(index)}`]),
        uploaded: false,
      });
    }
  };

  it('persists chunks and lists them per recording', async () => {
    await record('a', 3);
    await record('b', 2);
    expect((await store.listChunks('a')).map((c) => c.index)).toEqual([0, 1, 2]);
    await store.deleteRecording('a');
    expect(await store.listChunks('a')).toEqual([]);
    expect(await store.getRecording('b')).toBeDefined();
    expect(await store.getChunk('b', 1)).toBeDefined();
  });

  it('sends the speaker count with a start that is retried after being offline', async () => {
    await record('r', 1);
    await store.updateRecording('r', { speakers: 2 });
    server.failNext = [offline];
    await syncRecording('r', deps());
    expect(server.starts).toEqual([
      { id: 'r', mimeType: 'audio/webm', startedAt: '2026-10-22T12:03:00.000Z', speakers: 2 },
    ]);
    expect(sleeps).toHaveLength(1);
  });

  it('leaves the speaker count out when it is automatic', async () => {
    await record('r', 1);
    await syncRecording('r', deps());
    expect(server.starts[0]).not.toHaveProperty('speakers');
  });

  it('uploads every chunk, finishes with the stored duration and clears the device', async () => {
    await record('r', 5);
    const result = await syncRecording('r', deps());
    expect(result.kind).toBe('done');
    expect([...server.chunks.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(server.finishInput).toEqual({ chunks: 5, durationMs: 480_000 });
    expect(await store.getRecording('r')).toBeUndefined();
    expect(await store.getChunk('r', 0)).toBeUndefined();
  });

  it('uploads in order with at most two in flight', async () => {
    await record('r', 6);
    let inFlight = 0;
    let peak = 0;
    const put = server.putChunk;
    server.putChunk = async (id, index, blob) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await put(id, index, blob);
      inFlight -= 1;
    };
    await syncRecording('r', deps());
    expect(peak).toBe(2);
    expect(server.puts.slice(0, 2).sort()).toEqual([0, 1]);
    expect(server.puts).toHaveLength(6);
  });

  it('does not finish while the recording is still running', async () => {
    await record('r', 2, 'recording');
    expect((await syncRecording('r', deps())).kind).toBe('idle');
    expect(server.finishes).toBe(0);
    expect(server.chunks.size).toBe(2);
    await store.updateRecording('r', { state: 'stopped' });
    expect((await syncRecording('r', deps())).kind).toBe('done');
  });

  it('backs off exponentially while offline or on 5xx, then continues', async () => {
    await record('r', 2);
    server.failNext = [offline, offline, serverError, offline];
    expect((await syncRecording('r', deps())).kind).toBe('done');
    expect(sleeps.slice(0, 4)).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelay(10)).toBe(30_000);
  });

  it('waits on the injected sleep with fake timers and resumes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await record('r', 1);
    server.failNext = [offline];
    const timed: UploadDeps = {
      ...deps(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
    const run = syncRecording('r', timed);
    await vi.advanceTimersByTimeAsync(500);
    expect(server.puts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await run).kind).toBe('done');
  });

  it('does not retry a client error', async () => {
    await record('r', 1);
    server.failNext = [() => new HttpError(413, 'too large')];
    server.failNext.unshift(() => new HttpError(400, 'bad'));
    await expect(syncRecording('r', deps())).rejects.toBeInstanceOf(HttpError);
    expect(sleeps).toEqual([]);
    expect(await store.getRecording('r')).toBeDefined();
  });

  it('skips chunks the server already has (resume)', async () => {
    await record('r', 4);
    server.chunks.set(0, new Blob(['c0']));
    server.chunks.set(1, new Blob(['c1']));
    await syncRecording('r', deps());
    expect(server.puts.sort()).toEqual([2, 3]);
  });

  it('is idempotent when run again after a crash before cleanup', async () => {
    await record('r', 3);
    await syncRecording('r', deps());
    await record('r', 3);
    server.puts = [];
    const again = await syncRecording('r', deps());
    expect(again.kind).toBe('done');
    expect(server.puts).toEqual([]);
    expect(await store.getRecording('r')).toBeUndefined();
  });

  it('re-uploads chunks the server reports missing at finish', async () => {
    await record('r', 4);
    server.forgetOnce = new Set([1, 3]);
    const result = await syncRecording('r', deps());
    expect(result.kind).toBe('done');
    expect(server.finishes).toBe(2);
    expect(server.puts.filter((index) => index === 1)).toHaveLength(2);
  });

  it('fails clearly when a missing chunk is no longer on the device', async () => {
    await record('r', 2);
    server.forgetOnce = new Set([1]);
    const put = server.putChunk;
    server.putChunk = async (id, index, blob) => {
      await put(id, index, blob);
      if (index === 1)
        await store.deleteRecording(id).then(() =>
          store.putRecording({
            id,
            mimeType: 'audio/webm',
            startedAt: '2026-10-22T12:03:00.000Z',
            durationMs: 1,
            state: 'stopped',
            chunkCount: 2,
            uploadedCount: 0,
          }),
        );
    };
    await expect(syncRecording('r', deps())).rejects.toBeInstanceOf(UploadFailure);
  });

  it('syncs chunks that arrive while uploading', async () => {
    await record('r', 2, 'recording');
    const put = server.putChunk;
    let added = false;
    server.putChunk = async (id, index, blob) => {
      await put(id, index, blob);
      if (!added) {
        added = true;
        await store.putChunk({
          recordingId: id,
          index: 2,
          blob: new Blob(['c2']),
          uploaded: false,
        });
        await store.updateRecording(id, { chunkCount: 3, state: 'stopped' });
      }
    };
    const result = await syncRecording('r', deps());
    expect(result.kind).toBe('done');
    expect(server.chunks.size).toBe(3);
  });

  it('drops the local copy when the server already finished the recording', async () => {
    await record('r', 2);
    server.serverState = 'processing';
    const result = await syncRecording('r', deps());
    expect(result.kind).toBe('done');
    expect(server.puts).toEqual([]);
    expect(await store.getRecording('r')).toBeUndefined();
  });

  it('reports nothing to do for an unknown recording', async () => {
    expect((await syncRecording('nope', deps())).kind).toBe('gone');
  });

  it('lists unfinished recordings for recovery, newest context first', async () => {
    await record('crashed', 3, 'recording');
    await record('active', 2, 'recording');
    await store.putRecording({
      id: 'empty',
      mimeType: 'audio/webm',
      startedAt: '2026-10-22T12:00:00.000Z',
      durationMs: 0,
      state: 'recording',
      chunkCount: 0,
      uploadedCount: 0,
    });
    const found = await findUnfinished(store, 'active');
    expect(found.map((item) => item.id)).toEqual(['crashed']);
    expect(found[0]?.label).toMatch(/8m/);
    expect(await store.getRecording('empty')).toBeUndefined();
    expect(
      describeUnfinished(await store.getRecording('crashed').then((r) => r as LocalRecording)),
    ).toContain('8m');
  });

  it('seals a crashed recording from the chunks on disk and uploads it', async () => {
    await record('crashed', 3, 'recording');
    await store.updateRecording('crashed', { chunkCount: 1 });
    await sealForUpload(store, 'crashed');
    expect(await store.getRecording('crashed')).toMatchObject({ state: 'stopped', chunkCount: 3 });
    expect((await syncRecording('crashed', deps())).kind).toBe('done');
    expect(server.finishInput?.chunks).toBe(3);
  });

  it('discards locally and on the server, even when the server is unreachable', async () => {
    await record('r', 2);
    await discardRecording(store, server, 'r');
    expect(server.discarded).toBe(true);
    expect(await store.getRecording('r')).toBeUndefined();
    await record('s', 1);
    server.discard = () => Promise.reject(new NetworkError('offline'));
    await discardRecording(store, server, 's');
    expect(await store.getRecording('s')).toBeUndefined();
  });
});
