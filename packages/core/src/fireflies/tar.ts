import { ByteReader } from './bytes.js';

export interface TarEntry {
  name: string;
  kind: 'file' | 'directory' | 'other';
  size: number;
  body: AsyncIterable<Buffer>;
}

const BLOCK = 512;
const MAX_META_BYTES = 1024 * 1024;

const text = (buffer: Buffer) => {
  const end = buffer.indexOf(0);
  return buffer.toString('utf8', 0, end < 0 ? buffer.length : end);
};

function number(field: Buffer): number {
  if (((field[0] ?? 0) & 0x80) !== 0) {
    return field.subarray(1).reduce((total, byte) => total * 256 + byte, (field[0] ?? 0) & 0x7f);
  }
  return Number.parseInt(text(field).trim() || '0', 8);
}

function checksumOk(header: Buffer): boolean {
  let sum = 0;
  header.forEach((byte, index) => {
    sum += index >= 148 && index < 156 ? 0x20 : byte;
  });
  return sum === number(header.subarray(148, 156));
}

function paxFields(data: Buffer): Record<string, string> {
  const fields: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    const length = Number.parseInt(data.toString('utf8', offset, space), 10);
    if (space < 0 || !(length > 0)) break;
    const record = data.toString('utf8', space + 1, offset + length - 1);
    const equals = record.indexOf('=');
    if (equals > 0) fields[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return fields;
}

const kindOf = (type: string): TarEntry['kind'] =>
  type === '0' || type === '\0' ? 'file' : type === '5' ? 'directory' : 'other';

/**
 * Entries of a tar stream, one at a time. The body of an entry can be read or ignored: the reader
 * moves past whatever is left of it before it yields the next entry.
 */
export async function* readTar(source: AsyncIterable<Buffer>): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(source[Symbol.asyncIterator]());
  let pax: Record<string, string> = {};
  let longName: string | undefined;

  const metadata = async (size: number) => {
    if (size > MAX_META_BYTES) throw new Error('The archive has an oversized header');
    const data = await reader.exact(size);
    await reader.skip((BLOCK - (size % BLOCK)) % BLOCK);
    return data;
  };

  for (;;) {
    const header = await reader.take(BLOCK);
    if (header.length === 0 || header.every((byte) => byte === 0)) return;
    if (header.length < BLOCK || !checksumOk(header)) throw new Error('The archive is damaged');
    const type = String.fromCharCode(header[156] ?? 0);
    const declared = number(header.subarray(124, 136));

    if (type === 'x') pax = paxFields(await metadata(declared));
    else if (type === 'L') longName = text(await metadata(declared));
    else if (type === 'g' || type === 'K') await metadata(declared);
    else {
      const prefix = text(header.subarray(345, 500));
      const own = text(header.subarray(0, 100));
      const name = pax['path'] ?? longName ?? (prefix ? `${prefix}/${own}` : own);
      const size = pax['size'] ? Number(pax['size']) : declared;
      pax = {};
      longName = undefined;
      let read = 0;
      yield {
        name,
        kind: kindOf(type),
        size,
        body: reader.pieces(size, (length) => (read += length)),
      };
      await reader.skip(size - read + ((BLOCK - (size % BLOCK)) % BLOCK));
    }
  }
}
