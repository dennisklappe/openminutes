import { oggCrc } from './ogg-clip.js';

export const PRE_SKIP = 312;
export const PAGE_MS = 1000;

export function page(sequence: number, granule: bigint, payload: Buffer, type = 0): Buffer {
  const header = Buffer.alloc(27 + 1);
  header.write('OggS', 0, 'latin1');
  header[5] = type;
  header.writeBigInt64LE(granule, 6);
  header.writeUInt32LE(1, 14);
  header.writeUInt32LE(sequence, 18);
  header[26] = 1;
  header[27] = payload.length;
  const whole = Buffer.concat([header, payload]);
  whole.writeUInt32LE(oggCrc(whole), 22);
  return whole;
}

/** An Ogg Opus file of `seconds` pages of one second each, every page filled with its own number. */
export function oggFile(seconds: number): Buffer {
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'latin1');
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(PRE_SKIP, 10);
  const pages = [page(0, 0n, head, 2), page(1, 0n, Buffer.from('OpusTags....'))];
  for (let i = 0; i < seconds; i++) {
    const granule = BigInt(PRE_SKIP + (i + 1) * PAGE_MS * 48);
    pages.push(page(i + 2, granule, Buffer.alloc(200, i)));
  }
  return Buffer.concat(pages);
}
