import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioStorage, LocalStorage } from '@openminutes/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { cutOggClip, oggCrc, OggClipError, pagesIn, rebase } from './ogg-clip.js';
import { oggFile, page, PAGE_MS, PRE_SKIP } from './ogg-clip.fixture.js';

describe('cutOggClip', () => {
  let storage: AudioStorage;
  const file = oggFile(600);

  beforeAll(async () => {
    const local = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-ogg-')));
    await local.write('long.opus', file);
    await local.write('plain.opus', Buffer.from('not an ogg file at all'));
    storage = new AudioStorage(local);
  });

  it('copies the header pages and only the pages around the wanted stretch', async () => {
    const clip = await cutOggClip(storage, 'long.opus', file.length, 300_000, 305_000);
    expect(clip.body.length).toBeLessThan(file.length / 20);
    const pages = pagesIn(clip.body, 0);
    expect(pages.map((p) => p.granule).slice(0, 2)).toEqual([0n, 0n]);
    const fills = pages.slice(2).map((p) => clip.body[p.end - 1]);
    expect(fills[0]).toBeGreaterThanOrEqual(298 % 256);
    expect(fills).toContain(304 % 256);
    expect(fills.length).toBeLessThan(10);
  });

  it('puts the clip on a timeline of its own and tells where the start is', async () => {
    const clip = await cutOggClip(storage, 'long.opus', file.length, 300_000, 305_000);
    const pages = pagesIn(clip.body, 0);
    const audio = pages.slice(2);
    expect(audio[0]?.granule).toBe(BigInt(PRE_SKIP + PAGE_MS * 48));
    expect(audio.map((p, i) => [p.granule, i])).toSatisfy((rows: [bigint, number][]) =>
      rows.every(([granule, i]) => granule === BigInt(PRE_SKIP + (i + 1) * PAGE_MS * 48)),
    );
    expect(clip.offsetMs).toBe(1000);
    for (const p of pages) {
      const copy = Buffer.from(clip.body.subarray(p.start, p.end));
      const crc = copy.readUInt32LE(22);
      copy.writeUInt32LE(0, 22);
      expect(oggCrc(copy)).toBe(crc);
    }
  });

  it('cuts at the very start and the very end of the file', async () => {
    const start = await cutOggClip(storage, 'long.opus', file.length, 0, 2000);
    expect(start.offsetMs).toBe(0);
    expect(pagesIn(start.body, 0).length).toBeGreaterThan(3);
    const end = await cutOggClip(storage, 'long.opus', file.length, 598_000, 700_000);
    expect(pagesIn(end.body, 0).length).toBeGreaterThan(3);
  });

  it('refuses a file that is not Ogg Opus, and stops when cancelled', async () => {
    const plain = Buffer.from('not an ogg file at all');
    await expect(cutOggClip(storage, 'plain.opus', plain.length, 0, 1000)).rejects.toBeInstanceOf(
      OggClipError,
    );
    const stop = new AbortController();
    stop.abort();
    await expect(
      cutOggClip(storage, 'long.opus', file.length, 300_000, 305_000, stop.signal),
    ).rejects.toBeInstanceOf(OggClipError);
  });

  it('rebases page numbers and granules', () => {
    const moved = rebase(page(9, 5000n, Buffer.from('x')), 1000n, 2);
    const [only] = pagesIn(moved, 0);
    expect(only?.granule).toBe(4000n);
    expect(moved.readUInt32LE(18)).toBe(2);
  });
});
