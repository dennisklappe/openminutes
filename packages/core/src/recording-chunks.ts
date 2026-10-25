import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { meetingFolder } from './audio-paths.js';
import type { LocalStorage } from './storage.js';

export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_CHUNK_INDEX = 20_000;
export const MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;

const mimeTypes = {
  'audio/webm': { extension: 'webm', codec: 'webm' },
  'audio/ogg': { extension: 'ogg', codec: 'ogg' },
  'audio/mp4': { extension: 'm4a', codec: 'mp4' },
  'audio/aac': { extension: 'aac', codec: 'aac' },
  'audio/mpeg': { extension: 'mp3', codec: 'mp3' },
} as const;

export type RecordingFormat = (typeof mimeTypes)[keyof typeof mimeTypes];

export function recordingFormat(mimeType: string): RecordingFormat | undefined {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return (mimeTypes as Record<string, RecordingFormat | undefined>)[base];
}

const ascii = (head: Uint8Array, start: number, text: string) =>
  text.split('').every((char, index) => head[start + index] === char.charCodeAt(0));

/**
 * Whether the first bytes of a recording are what its declared format starts with. The type
 * comes from the client, so the file is checked before anything decodes it.
 */
export function matchesFormat(format: RecordingFormat, head: Uint8Array): boolean {
  switch (format.codec) {
    case 'webm':
      return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    case 'ogg':
      return ascii(head, 0, 'OggS');
    case 'mp4':
      return ['ftyp', 'styp', 'moov'].some((box) => ascii(head, 4, box));
    case 'aac':
      return head[0] === 0xff && ((head[1] ?? 0) & 0xf6) === 0xf0;
    case 'mp3':
      return ascii(head, 0, 'ID3') || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0);
  }
}

export async function readChunkHead(
  storage: LocalStorage,
  recordingId: string,
  index: number,
): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const part of storage.read(chunkPath(recordingId, index), { start: 0, end: 15 })) {
    parts.push(part as Buffer);
  }
  return Buffer.concat(parts);
}

export class ChunkLimitError extends Error {
  constructor() {
    super('The chunk or the recording is too large');
  }
}

const chunksFolder = (recordingId: string) => `${meetingFolder(recordingId)}/chunks`;
const chunkName = (index: number) => `${String(index).padStart(6, '0')}.part`;
const chunkPath = (recordingId: string, index: number) =>
  `${chunksFolder(recordingId)}/${chunkName(index)}`;
const formatPath = (recordingId: string) => `${chunksFolder(recordingId)}/format`;
const finalPath = (recordingId: string, format: RecordingFormat) =>
  `${meetingFolder(recordingId)}/recording.${format.extension}`;

async function writeAtomically(
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

export async function saveRecordingFormat(
  storage: LocalStorage,
  recordingId: string,
  format: RecordingFormat,
): Promise<void> {
  await storage.write(formatPath(recordingId), new TextEncoder().encode(format.extension));
}

export async function loadRecordingFormat(
  storage: LocalStorage,
  recordingId: string,
): Promise<RecordingFormat> {
  const extension = await readFirstLine(storage, formatPath(recordingId));
  const format = Object.values(mimeTypes).find((candidate) => candidate.extension === extension);
  if (!format) throw new Error('The recording format is missing');
  return format;
}

async function readFirstLine(storage: LocalStorage, path: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const part of storage.read(path)) chunks.push(part as Buffer);
  return Buffer.concat(chunks).toString().trim();
}

export async function receivedChunks(
  storage: LocalStorage,
  recordingId: string,
): Promise<number[]> {
  const names = await readdir(storage.absolutePath(chunksFolder(recordingId))).catch(() => []);
  return names
    .filter((name) => name.endsWith('.part'))
    .map((name) => Number.parseInt(name, 10))
    .sort((a, b) => a - b);
}

export function missingChunks(received: readonly number[], count: number): number[] {
  const have = new Set(received);
  return Array.from({ length: count }, (_, index) => index).filter((index) => !have.has(index));
}

async function storedBytes(
  storage: LocalStorage,
  recordingId: string,
  except: number,
): Promise<number> {
  const received = await receivedChunks(storage, recordingId);
  const sizes = await Promise.all(
    received
      .filter((index) => index !== except)
      .map((index) => storage.size(chunkPath(recordingId, index))),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
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

export async function saveChunk(
  storage: LocalStorage,
  recordingId: string,
  index: number,
  body: Readable,
): Promise<void> {
  const room = MAX_RECORDING_BYTES - (await storedBytes(storage, recordingId, index));
  const limit = Math.min(MAX_CHUNK_BYTES, room);
  await writeAtomically(storage, chunkPath(recordingId, index), (temporary) =>
    pipeline(body, limited(limit), createWriteStream(temporary)),
  );
}

export async function assembleChunks(
  storage: LocalStorage,
  recordingId: string,
  count: number,
  format: RecordingFormat,
): Promise<{ path: string; size: number }> {
  const path = finalPath(recordingId, format);
  const parts = async function* () {
    for (let index = 0; index < count; index++) {
      yield* storage.read(chunkPath(recordingId, index));
    }
  };
  await writeAtomically(storage, path, (temporary) =>
    pipeline(parts, createWriteStream(temporary)),
  );
  return { path, size: (await stat(storage.absolutePath(path))).size };
}

export const removeChunks = (storage: LocalStorage, recordingId: string) =>
  storage.removeDirectory(chunksFolder(recordingId));

export const removeRecordingFolder = (storage: LocalStorage, recordingId: string) =>
  storage.removeDirectory(meetingFolder(recordingId));
