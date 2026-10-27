import type { Readable } from 'node:stream';
import { meetingFolder } from './audio-paths.js';
import { ChunkStore } from './chunk-store.js';
import type { LocalStorage } from './storage.js';

export { ChunkLimitError, MAX_CHUNK_BYTES, missingChunks } from './chunk-store.js';
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

const chunksFolder = (recordingId: string) => `${meetingFolder(recordingId)}/chunks`;
const store = (storage: LocalStorage, recordingId: string) =>
  new ChunkStore(storage, chunksFolder(recordingId), MAX_RECORDING_BYTES);
const formatPath = (recordingId: string) => `${chunksFolder(recordingId)}/format`;
const finalPath = (recordingId: string, format: RecordingFormat) =>
  `${meetingFolder(recordingId)}/recording.${format.extension}`;

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

export const readChunkHead = (storage: LocalStorage, recordingId: string, index: number) =>
  store(storage, recordingId).head(index);

export const receivedChunks = (storage: LocalStorage, recordingId: string) =>
  store(storage, recordingId).received();

export const saveChunk = (
  storage: LocalStorage,
  recordingId: string,
  index: number,
  body: Readable,
) => store(storage, recordingId).save(index, body);

export async function assembleChunks(
  storage: LocalStorage,
  recordingId: string,
  count: number,
  format: RecordingFormat,
): Promise<{ path: string; size: number }> {
  const path = finalPath(recordingId, format);
  return { path, size: await store(storage, recordingId).assemble(count, path) };
}

export const removeChunks = (storage: LocalStorage, recordingId: string) =>
  store(storage, recordingId).remove();

export const removeRecordingFolder = (storage: LocalStorage, recordingId: string) =>
  storage.removeDirectory(meetingFolder(recordingId));
