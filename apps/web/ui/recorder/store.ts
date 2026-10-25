export type LocalState = 'recording' | 'stopped';

export interface LocalRecording {
  id: string;
  mimeType: string;
  startedAt: string;
  durationMs: number;
  state: LocalState;
  chunkCount: number;
  uploadedCount: number;
  speakers?: number;
}

export interface LocalChunk {
  recordingId: string;
  index: number;
  blob: Blob;
  uploaded: boolean;
}

// Chunks are stored as bytes, not as Blob: WebKit cannot write a Blob into IndexedDB in a private
// tab (the transaction fails), and bytes work everywhere.
interface StoredChunk {
  recordingId: string;
  index: number;
  data: ArrayBuffer;
  type: string;
  uploaded: boolean;
}

const DB_NAME = 'openminutes-recorder';
const RECORDINGS = 'recordings';
const CHUNKS = 'chunks';

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    };
  });

export function openRecorderDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  const request = factory.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore(RECORDINGS, { keyPath: 'id' });
    db.createObjectStore(CHUNKS, { keyPath: ['recordingId', 'index'] });
  };
  return done(request);
}

export class RecorderStore {
  constructor(private readonly db: IDBDatabase) {}

  async putRecording(recording: LocalRecording): Promise<void> {
    const tx = this.db.transaction(RECORDINGS, 'readwrite');
    tx.objectStore(RECORDINGS).put(recording);
    await finished(tx);
  }

  async updateRecording(id: string, patch: Partial<Omit<LocalRecording, 'id'>>): Promise<void> {
    const tx = this.db.transaction(RECORDINGS, 'readwrite');
    const store = tx.objectStore(RECORDINGS);
    const current = (await done(store.get(id))) as LocalRecording | undefined;
    if (current) store.put({ ...current, ...patch });
    await finished(tx);
  }

  async getRecording(id: string): Promise<LocalRecording | undefined> {
    const tx = this.db.transaction(RECORDINGS);
    return (await done(tx.objectStore(RECORDINGS).get(id))) as LocalRecording | undefined;
  }

  async listRecordings(): Promise<LocalRecording[]> {
    const tx = this.db.transaction(RECORDINGS);
    const all = (await done(tx.objectStore(RECORDINGS).getAll())) as LocalRecording[];
    return all.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  async putChunk(chunk: LocalChunk): Promise<void> {
    const { blob, ...rest } = chunk;
    const stored: StoredChunk = { ...rest, data: await blob.arrayBuffer(), type: blob.type };
    const tx = this.db.transaction(CHUNKS, 'readwrite');
    tx.objectStore(CHUNKS).put(stored);
    await finished(tx);
  }

  async getChunk(recordingId: string, index: number): Promise<LocalChunk | undefined> {
    const tx = this.db.transaction(CHUNKS);
    const stored = (await done(tx.objectStore(CHUNKS).get([recordingId, index]))) as
      StoredChunk | undefined;
    if (!stored) return undefined;
    // Chunks saved by an earlier release still hold a Blob.
    if (!('data' in stored)) return stored;
    const { data, type, ...rest } = stored;
    return { ...rest, blob: new Blob([data], { type }) };
  }

  async markUploaded(recordingId: string, index: number): Promise<void> {
    const tx = this.db.transaction(CHUNKS, 'readwrite');
    const store = tx.objectStore(CHUNKS);
    const chunk = (await done(store.get([recordingId, index]))) as StoredChunk | undefined;
    if (chunk) store.put({ ...chunk, uploaded: true });
    await finished(tx);
  }

  listChunks(recordingId: string): Promise<Pick<LocalChunk, 'index' | 'uploaded'>[]> {
    const tx = this.db.transaction(CHUNKS);
    const range = IDBKeyRange.bound([recordingId, 0], [recordingId, Number.MAX_SAFE_INTEGER]);
    const found: Pick<LocalChunk, 'index' | 'uploaded'>[] = [];
    const request = tx.objectStore(CHUNKS).openCursor(range);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(found);
          return;
        }
        const { index, uploaded } = cursor.value as StoredChunk;
        found.push({ index, uploaded });
        cursor.continue();
      };
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB cursor failed'));
      };
    });
  }

  async deleteRecording(id: string): Promise<void> {
    const tx = this.db.transaction([RECORDINGS, CHUNKS], 'readwrite');
    tx.objectStore(RECORDINGS).delete(id);
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    await finished(tx);
  }
}
