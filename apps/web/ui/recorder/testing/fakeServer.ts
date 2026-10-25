import type { RecordingStartInput, RecordingStatusDto } from '../../../src/dto.js';
import { HttpError, NetworkError, type RecordingsClient } from '../client.js';

export class FakeServer implements RecordingsClient {
  chunks = new Map<number, Blob>();
  puts: number[] = [];
  starts: RecordingStartInput[] = [];
  finishes = 0;
  serverState: RecordingStatusDto['status'] = 'uploading';
  failNext: (() => Error)[] = [];
  forgetOnce = new Set<number>();
  discarded = false;
  finishInput: { chunks: number; durationMs: number } | undefined;

  private view(id: string): RecordingStatusDto {
    return {
      id,
      status: this.serverState,
      received: [...this.chunks.keys()],
      maxChunkBytes: 1_000_000,
    };
  }

  private maybeFail() {
    const next = this.failNext.shift();
    if (next) throw next();
  }

  start: RecordingsClient['start'] = (input) => {
    this.maybeFail();
    this.starts.push(input);
    return Promise.resolve(this.view(input.id));
  };

  status: RecordingsClient['status'] = (id) => Promise.resolve(this.view(id));

  putChunk: RecordingsClient['putChunk'] = (_id, index, blob) => {
    this.maybeFail();
    this.puts.push(index);
    if (this.forgetOnce.delete(index)) return Promise.resolve();
    this.chunks.set(index, blob);
    return Promise.resolve();
  };

  finish: RecordingsClient['finish'] = (id, input) => {
    this.maybeFail();
    this.finishes += 1;
    const missing = [...Array(input.chunks).keys()].filter((index) => !this.chunks.has(index));
    if (missing.length > 0) {
      return Promise.reject(new HttpError(409, 'Missing chunks', { missing }));
    }
    this.finishInput = input;
    this.serverState = 'processing';
    return Promise.resolve(this.view(id));
  };

  discard: RecordingsClient['discard'] = () => {
    this.discarded = true;
    return Promise.resolve();
  };
}

export const offline = () => new NetworkError('offline');
export const serverError = () => new HttpError(503, 'unavailable');
