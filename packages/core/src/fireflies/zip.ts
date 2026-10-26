import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream';
import { createInflateRaw } from 'node:zlib';

export interface ZipEntry {
  name: string;
  kind: 'file' | 'directory' | 'other';
  size: number;
  body: () => AsyncIterable<Buffer>;
}

const END_SIGNATURE = 0x06054b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const SEARCH_BYTES = 65_557 + 22;
const MAX_ENTRIES = 1_000_000;
const UNIX = 3;
const S_IFMT = 0xf000;
const S_IFREG = 0x8000;
const S_IFDIR = 0x4000;

class ZipError extends Error {
  constructor(message = 'The zip file is damaged or not supported') {
    super(message);
  }
}

type Read = (position: number, length: number) => Promise<Buffer>;

const big = (buffer: Buffer, offset: number) => Number(buffer.readBigUInt64LE(offset));

async function locateDirectory(
  read: Read,
  fileSize: number,
): Promise<{ offset: number; count: number }> {
  const start = Math.max(0, fileSize - SEARCH_BYTES);
  const tail = await read(start, fileSize - start);
  const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || tail.readUInt32LE(end) !== END_SIGNATURE) throw new ZipError();
  let count = tail.readUInt16LE(end + 10);
  let offset = tail.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff) {
    const locator = start + end - 20;
    const pointer = await read(locator, 20);
    if (locator < 0 || pointer.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE) throw new ZipError();
    const record = await read(big(pointer, 8), 56);
    if (record.readUInt32LE(0) !== ZIP64_END_SIGNATURE) throw new ZipError();
    count = big(record, 32);
    offset = big(record, 48);
  }
  if (count > MAX_ENTRIES) throw new ZipError('The zip file has too many entries');
  return { offset, count };
}

interface Sizes {
  compressed: number;
  size: number;
  header: number;
}

function zip64(extra: Buffer, sizes: Sizes, wanted: Record<keyof Sizes, boolean>): void {
  for (let at = 0; at + 4 <= extra.length;) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === 1) {
      let position = at + 4;
      for (const key of ['size', 'compressed', 'header'] as const) {
        if (!wanted[key]) continue;
        sizes[key] = big(extra, position);
        position += 8;
      }
    }
    at += 4 + length;
  }
}

async function* unpack(path: string, sizes: Sizes, method: number): AsyncGenerator<Buffer> {
  if (sizes.compressed === 0) return;
  const handle = await open(path, 'r');
  try {
    const local = Buffer.alloc(30);
    const { bytesRead } = await handle.read(local, 0, 30, sizes.header);
    if (bytesRead < 30 || local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new ZipError();
    const start = sizes.header + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    const raw = createReadStream(path, { start, end: start + sizes.compressed - 1 });
    if (method === 0) {
      yield* raw as AsyncIterable<Buffer>;
      return;
    }
    const inflated = createInflateRaw();
    pipeline(raw, inflated, () => undefined);
    yield* inflated as AsyncIterable<Buffer>;
  } finally {
    await handle.close();
  }
}

/** The entries of a zip file, read from its central directory. Nothing is unpacked here. */
export async function readZip(path: string): Promise<ZipEntry[]> {
  const handle = await open(path, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    const read: Read = async (position, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead < length) throw new ZipError();
      return buffer;
    };
    const { offset, count } = await locateDirectory(read, fileSize);
    const directory = await read(offset, fileSize - offset);
    const entries: ZipEntry[] = [];
    let at = 0;
    for (let index = 0; index < count; index++) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== ENTRY_SIGNATURE) {
        throw new ZipError();
      }
      const flags = directory.readUInt16LE(at + 8);
      const method = directory.readUInt16LE(at + 10);
      const sizes: Sizes = {
        compressed: directory.readUInt32LE(at + 20),
        size: directory.readUInt32LE(at + 24),
        header: directory.readUInt32LE(at + 42),
      };
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const name = directory.toString('utf8', at + 46, at + 46 + nameLength);
      zip64(directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength), sizes, {
        size: sizes.size === 0xffffffff,
        compressed: sizes.compressed === 0xffffffff,
        header: sizes.header === 0xffffffff,
      });
      const mode =
        directory.readUInt8(at + 5) === UNIX ? directory.readUInt32LE(at + 38) >>> 16 : 0;
      const kind =
        (flags & 1) !== 0 || (method !== 0 && method !== 8)
          ? 'other'
          : name.endsWith('/') || (mode & S_IFMT) === S_IFDIR
            ? 'directory'
            : mode === 0 || (mode & S_IFMT) === S_IFREG
              ? 'file'
              : 'other';
      entries.push({
        name,
        kind,
        size: sizes.size,
        body: () => unpack(path, sizes, method),
      });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}
