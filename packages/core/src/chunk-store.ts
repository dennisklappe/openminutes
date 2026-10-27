import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { LocalStorage } from './storage.js';

export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

export class ChunkLimitError extends Error {
  constructor() {
    super('The chunk or the recording is too large');
  }
}

export async function writeAtomically(
  storage: LocalStorage,
  path: string,
  write: (temporary: string) => Promise<void>,
): Promise<void> {
  const target = storage.absolutePath(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await write(temporary);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function limited(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      done(seen > maxBytes ? new ChunkLimitError() : null, chunk);
    },
  });
}

/** Numbered parts of one upload in a folder of the local storage, for uploads cut into chunks. */
export class ChunkStore {
  constructor(
    private readonly storage: LocalStorage,
    private readonly folder: string,
    private readonly maxTotalBytes: number,
  ) {}

  path(index: number): string {
    return `${this.folder}/${String(index).padStart(6, '0')}.part`;
  }

  async received(): Promise<number[]> {
    const names = await readdir(this.storage.absolutePath(this.folder)).catch(() => []);
    return names
      .filter((name) => name.endsWith('.part'))
      .map((name) => Number.parseInt(name, 10))
      .sort((a, b) => a - b);
  }

  private async storedBytes(except: number): Promise<number> {
    const sizes = await Promise.all(
      (await this.received())
        .filter((index) => index !== except)
        .map((index) => this.storage.size(this.path(index))),
    );
    return sizes.reduce((sum, size) => sum + size, 0);
  }

  async save(index: number, body: Readable): Promise<void> {
    const room = this.maxTotalBytes - (await this.storedBytes(index));
    const limit = Math.min(MAX_CHUNK_BYTES, room);
    await writeAtomically(this.storage, this.path(index), (temporary) =>
      pipeline(body, limited(limit), createWriteStream(temporary)),
    );
  }

  async head(index: number): Promise<Uint8Array> {
    const parts: Buffer[] = [];
    for await (const part of this.storage.read(this.path(index), { start: 0, end: 15 })) {
      parts.push(part as Buffer);
    }
    return Buffer.concat(parts);
  }

  async assemble(count: number, target: string): Promise<number> {
    const parts = async function* (store: ChunkStore) {
      for (let index = 0; index < count; index++) yield* store.storage.read(store.path(index));
    };
    await writeAtomically(this.storage, target, (temporary) =>
      pipeline(() => parts(this), createWriteStream(temporary)),
    );
    return (await stat(this.storage.absolutePath(target))).size;
  }

  remove(): Promise<void> {
    return this.storage.removeDirectory(this.folder);
  }
}

export const missingChunks = (received: readonly number[], count: number): number[] => {
  const have = new Set(received);
  return Array.from({ length: count }, (_, index) => index).filter((index) => !have.has(index));
};
