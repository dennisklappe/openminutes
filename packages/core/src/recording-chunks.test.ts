import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  assembleChunks,
  ChunkLimitError,
  matchesFormat,
  MAX_CHUNK_BYTES,
  missingChunks,
  receivedChunks,
  recordingFormat,
  removeChunks,
  saveChunk,
} from './recording-chunks.js';
import { LocalStorage } from './storage.js';

const id = '5c8d3a52-0000-4000-8000-000000000001';
const webm = recordingFormat('audio/webm;codecs=opus');

async function setup() {
  return new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-chunks-')));
}
const body = (text: string) => Readable.from([Buffer.from(text)]);

describe('recording chunks', () => {
  it('knows the allowed formats', () => {
    expect(webm?.extension).toBe('webm');
    expect(recordingFormat('audio/mp4')?.codec).toBe('mp4');
    expect(recordingFormat('video/mp4')).toBeUndefined();
  });

  it('assembles chunks uploaded out of order and ignores duplicates', async () => {
    const storage = await setup();
    await saveChunk(storage, id, 2, body('cc'));
    await saveChunk(storage, id, 0, body('aa'));
    await saveChunk(storage, id, 1, body('bb'));
    await saveChunk(storage, id, 1, body('bb'));

    expect(await receivedChunks(storage, id)).toEqual([0, 1, 2]);
    if (!webm) throw new Error('format');
    const file = await assembleChunks(storage, id, 3, webm);
    expect(file.size).toBe(6);
    expect((await readFile(storage.absolutePath(file.path))).toString()).toBe('aabbcc');

    await removeChunks(storage, id);
    expect(await receivedChunks(storage, id)).toEqual([]);
  });

  it('reports missing chunks', async () => {
    const storage = await setup();
    await saveChunk(storage, id, 0, body('a'));
    await saveChunk(storage, id, 3, body('d'));
    expect(missingChunks(await receivedChunks(storage, id), 5)).toEqual([1, 2, 4]);
  });

  it('rejects an oversize chunk and leaves nothing behind', async () => {
    const storage = await setup();
    const big = Readable.from([Buffer.alloc(MAX_CHUNK_BYTES + 1)]);
    await expect(saveChunk(storage, id, 0, big)).rejects.toBeInstanceOf(ChunkLimitError);
    expect(await receivedChunks(storage, id)).toEqual([]);
  });
});

describe('matchesFormat', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const text = (value: string) => new TextEncoder().encode(value);
  const format = (mime: string) => {
    const found = recordingFormat(mime);
    if (!found) throw new Error(mime);
    return found;
  };

  it('accepts what each format starts with', () => {
    expect(matchesFormat(format('audio/webm'), bytes(0x1a, 0x45, 0xdf, 0xa3, 1))).toBe(true);
    expect(matchesFormat(format('audio/ogg'), text('OggS\0'))).toBe(true);
    expect(matchesFormat(format('audio/mp4'), text('\0\0\0\x18ftypM4A '))).toBe(true);
    expect(matchesFormat(format('audio/aac'), bytes(0xff, 0xf1, 0x50))).toBe(true);
    expect(matchesFormat(format('audio/mpeg'), text('ID3\x04'))).toBe(true);
    expect(matchesFormat(format('audio/mpeg'), bytes(0xff, 0xfb, 0x90))).toBe(true);
  });

  it('refuses text, playlists and another format', () => {
    const playlist = text('#EXTM3U\n#EXT-X-TARGETDURATION:10\n');
    for (const mime of ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/mpeg']) {
      expect(matchesFormat(format(mime), playlist)).toBe(false);
      expect(matchesFormat(format(mime), new Uint8Array())).toBe(false);
    }
    expect(matchesFormat(format('audio/ogg'), bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe(false);
  });
});
