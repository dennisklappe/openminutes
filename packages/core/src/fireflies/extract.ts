import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { pipeline } from 'node:stream';
import { finished } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { readTar } from './tar.js';
import { readZip } from './zip.js';

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export interface ExtractLimits {
  maxBytes: number;
  maxEntries: number;
}

interface Entry {
  name: string;
  kind: 'file' | 'directory' | 'other';
  size: number;
  body: () => AsyncIterable<Buffer>;
}

const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const MAX_NAME_LENGTH = 1024;
export const FIREFLIES_ID = /^[A-Za-z0-9]{8,64}$/;

const FIXED_FILES = new Set(['audio.mp3']);
const FILES_WITH_ID: [RegExp, string][] = [
  [/^meeting-metadata-([A-Za-z0-9]+)\.txt$/, 'metadata.json'],
];

function splitPath(raw: string): { folder: string; base: string } {
  const name = raw.replaceAll('\\', '/');
  const segments = name.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (
    name.length > MAX_NAME_LENGTH ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    segments.includes('..')
  ) {
    throw new ArchiveError('The archive contains an unsafe file path');
  }
  return { folder: segments.slice(0, -1).join('/'), base: segments.at(-1) ?? '' };
}

/** Which file of a meeting this is, and the Fireflies id when the name carries it. */
function classify(base: string): { stored: string; id?: string } | undefined {
  if (FIXED_FILES.has(base)) return { stored: base };
  for (const [pattern, stored] of FILES_WITH_ID) {
    const id = pattern.exec(base)?.[1];
    if (id) return { stored, id };
  }
  return undefined;
}

async function entriesOf(path: string): Promise<AsyncIterable<Entry> | Iterable<Entry>> {
  const handle = await open(path, 'r');
  const magic = Buffer.alloc(4);
  await handle.read(magic, 0, 4, 0);
  await handle.close();
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    const gunzip = createGunzip();
    pipeline(createReadStream(path), gunzip, () => undefined);
    const tar = readTar(gunzip);
    return (async function* () {
      for await (const entry of tar) yield { ...entry, body: () => entry.body };
    })();
  }
  if (magic.toString('latin1', 0, 2) === 'PK') {
    return readZip(path);
  }
  throw new ArchiveError('This is not a .tar.gz or .zip file');
}

class Budget {
  private entries = 0;
  private bytes = 0;

  constructor(private readonly limits: ExtractLimits) {}

  entry(): void {
    if (++this.entries > this.limits.maxEntries) {
      throw new ArchiveError('The archive has too many files');
    }
  }

  declare(size: number): void {
    this.bytes += size;
    if (this.bytes > this.limits.maxBytes) {
      throw new ArchiveError('The archive is larger than the import limit once unpacked');
    }
  }
}

async function save(target: string, body: AsyncIterable<Buffer>, allowed: number): Promise<void> {
  const out = createWriteStream(target);
  let written = 0;
  try {
    for await (const piece of body) {
      written += piece.length;
      if (written > allowed) throw new ArchiveError('A file in the archive is larger than it says');
      if (!out.write(piece)) await once(out, 'drain');
    }
    out.end();
    await finished(out);
  } catch (error) {
    out.destroy();
    throw error;
  }
}

/**
 * Unpacks a Fireflies export into `destination/<fireflies id>/`, keeping only the recording and the
 * metadata under fixed names. The transcripts and summaries are never kept. Paths in the archive never reach the file system, links and devices are
 * refused, and the number of files and the unpacked size are capped. Returns the ids found.
 */
export async function extractExport(
  archive: string,
  destination: string,
  limits: ExtractLimits,
): Promise<string[]> {
  const entries = await entriesOf(archive);
  const budget = new Budget(limits);
  const folders = new Map<string, { temporary: string; id?: string }>();
  const scratch = join(destination, '.unpacking');
  try {
    await mkdir(scratch, { recursive: true });
    for await (const entry of entries) {
      budget.entry();
      const { folder, base } = splitPath(entry.name);
      if (entry.kind === 'other') {
        throw new ArchiveError('The archive contains a link, a device or an unsupported file');
      }
      if (entry.kind === 'directory') continue;
      budget.declare(entry.size);
      const role = classify(base);
      if (!role) continue;
      let slot = folders.get(folder);
      if (!slot) {
        slot = { temporary: join(scratch, String(folders.size)) };
        await mkdir(slot.temporary);
        folders.set(folder, slot);
      }
      if (role.id) slot.id = role.id;
      if (role.stored !== 'audio.mp3' && entry.size > MAX_TEXT_BYTES) {
        throw new ArchiveError('A text file in the archive is too large');
      }
      await save(join(slot.temporary, role.stored), entry.body(), entry.size);
    }
    const ids: string[] = [];
    for (const { temporary, id } of folders.values()) {
      if (!id || !FIREFLIES_ID.test(id) || ids.includes(id)) continue;
      await rename(temporary, join(destination, id));
      ids.push(id);
    }
    return ids;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
