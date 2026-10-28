import type { Readable } from 'node:stream';
import type { AudioStorage } from '@openminutes/core';

/** Ogg Opus granule positions count 48 kHz samples. */
const SAMPLES_PER_MS = 48;
/** Larger than any normal page, so a window always holds a whole page. */
const WINDOW = 128 * 1024;
/** Audio before the wanted start, so the decoder has settled when the clip begins. */
const LEAD_MS = 400;
const TAIL_MS = 200;
/** The longest clip served. */
export const MAX_CLIP_MS = 30_000;
const MAX_STEPS = 40;

export class OggClipError extends Error {}

interface Page {
  start: number;
  end: number;
  /** Absent for a page on which no packet ends. */
  granule: bigint | undefined;
}

/** The pages that lie completely inside `buffer`, which starts at byte `offset` of the file. */
export function pagesIn(buffer: Buffer, offset: number): Page[] {
  const pages: Page[] = [];
  let at = buffer.indexOf('OggS');
  while (at !== -1 && at + 27 <= buffer.length) {
    const segments = buffer[at + 26] ?? 0;
    const headerEnd = at + 27 + segments;
    if (buffer[at + 4] === 0 && headerEnd <= buffer.length) {
      let size = 0;
      for (let i = 0; i < segments; i++) size += buffer[at + 27 + i] ?? 0;
      const end = headerEnd + size;
      if (end > buffer.length) break;
      const granule = buffer.readBigInt64LE(at + 6);
      pages.push({
        start: offset + at,
        end: offset + end,
        granule: granule < 0n ? undefined : granule,
      });
      at = buffer.indexOf('OggS', end);
    } else at = buffer.indexOf('OggS', at + 1);
  }
  return pages;
}

async function readBytes(
  storage: AudioStorage,
  path: string,
  size: number,
  start: number,
  length: number,
): Promise<Buffer> {
  if (start >= size) return Buffer.alloc(0);
  const stream: Readable = await storage.read(path, {
    start,
    end: Math.min(size, start + length) - 1,
  });
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n << 24;
  for (let bit = 0; bit < 8; bit++)
    value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
  return value >>> 0;
});

export function oggCrc(page: Buffer): number {
  let crc = 0;
  for (const byte of page)
    crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
  return crc;
}

/** Moves the pages to a timeline of their own: granules start after `base`, numbers after `sequence`. */
export function rebase(pages: Buffer, base: bigint, sequence: number): Buffer {
  const out = Buffer.from(pages);
  pagesIn(out, 0).forEach((page, i) => {
    if (page.granule !== undefined) out.writeBigInt64LE(page.granule - base, page.start + 6);
    out.writeUInt32LE(sequence + i, page.start + 18);
    out.writeUInt32LE(0, page.start + 22);
    out.writeUInt32LE(oggCrc(out.subarray(page.start, page.end)), page.start + 22);
  });
  return out;
}

export interface Clip {
  /** The audio of the clip as an Ogg Opus file of its own. */
  body: Buffer;
  /** Where the wanted start lies inside the clip. */
  offsetMs: number;
}

/**
 * Cuts a short Ogg Opus clip out of a long file by copying whole pages, so nothing is decoded or
 * encoded and only a few reads happen. The file's own header pages come first, then the pages that
 * cover the wanted stretch. The pages are found with a bisection on their granule positions.
 */
export async function cutOggClip(
  storage: AudioStorage,
  path: string,
  size: number,
  fromMs: number,
  toMs: number,
  signal?: AbortSignal,
): Promise<Clip> {
  const check = () => {
    if (signal?.aborted) throw new OggClipError('Cancelled');
  };
  const head = await readBytes(storage, path, size, 0, WINDOW);
  const first = pagesIn(head, 0);
  const headers = first.filter((page, i) => page.granule === 0n && i < 4);
  const last = headers.at(-1);
  if (!last || head.toString('latin1', 0, 8) !== 'OggS\0\x02\0\0') {
    throw new OggClipError('Not an Ogg file');
  }
  const opusHead = head.indexOf('OpusHead');
  if (opusHead === -1) throw new OggClipError('Not an Opus file');
  const preSkip = head.readUInt16LE(opusHead + 10);

  /** The end of the last page that ends before `granule`, and of the first that ends at or after. */
  async function locate(granule: bigint) {
    let low = last?.end ?? 0;
    let lowGranule = 0n;
    let high = size;
    for (let step = 0; step < MAX_STEPS && high - low > WINDOW; step++) {
      check();
      const middle = low + Math.floor((high - low) / 2);
      const pages = pagesIn(await readBytes(storage, path, size, middle, WINDOW), middle);
      const probe = pages.find((page) => page.granule !== undefined);
      if (!probe?.granule) high = middle;
      else if (probe.granule < granule) {
        low = probe.end;
        lowGranule = probe.granule;
      } else high = probe.start;
    }
    check();
    let before = low;
    let beforeGranule = lowGranule;
    for (let at = low; at < size;) {
      const pages = pagesIn(await readBytes(storage, path, size, at, WINDOW * 2), at);
      if (pages.length === 0) break;
      for (const page of pages) {
        if (page.granule === undefined) continue;
        if (page.granule >= granule) return { before, beforeGranule, after: page.end };
        before = page.end;
        beforeGranule = page.granule;
      }
      at = pages.at(-1)?.end ?? size;
    }
    return { before, beforeGranule, after: size };
  }

  const wantFrom = BigInt(Math.max(0, fromMs - LEAD_MS) * SAMPLES_PER_MS + preSkip);
  const wantTo = BigInt((toMs + TAIL_MS) * SAMPLES_PER_MS + preSkip);
  const start = await locate(wantFrom);
  const end = await locate(wantTo);
  if (end.after <= start.before) throw new OggClipError('Nothing to play there');
  const body = await readBytes(storage, path, size, start.before, end.after - start.before);
  const beginsMs = Math.max(0, Number(start.beforeGranule - BigInt(preSkip)) / SAMPLES_PER_MS);
  const moved = rebase(body, start.beforeGranule - BigInt(preSkip), headers.length);
  return {
    body: Buffer.concat([head.subarray(0, last.end), moved]),
    offsetMs: Math.max(0, fromMs - beginsMs),
  };
}
