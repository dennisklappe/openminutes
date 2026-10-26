import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SYNTHETIC_MEETINGS, syntheticExport, tarGz } from '../testing/fireflies-export.js';
import { LocalStorage } from '../storage.js';
import {
  importChunks,
  loadStaged,
  removeImport,
  removeStaleImports,
  removeStagedMeeting,
  stageExport,
  uploadPath,
} from './stage.js';

const LIMITS = { maxBytes: 10_000_000, maxEntries: 100 };
const UPLOAD = '5c8d3a52-0000-4000-8000-000000000001';
const [planning, klant] = SYNTHETIC_MEETINGS;

describe('staging an export', () => {
  let storage: LocalStorage;
  beforeEach(async () => {
    storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'om-stage-')));
  });
  afterEach(() => rm(storage.root, { recursive: true, force: true }));

  async function upload(files = syntheticExport()) {
    await storage.write(uploadPath(UPLOAD), tarGz(files));
    return stageExport(storage, UPLOAD, LIMITS);
  }

  it('lists the meetings newest first, writes a manifest and removes the archive', async () => {
    const staged = await upload();
    expect(staged.unreadable).toBe(0);
    expect(
      staged.meetings.map((m) => [m.id, m.title, m.durationMs, m.attendees, m.hasAudio]),
    ).toEqual([
      [klant?.id, 'Klantgesprek', 5 * 60_000, 1, false],
      [planning?.id, 'Weekly planning', 12 * 60_000, 2, true],
    ]);
    expect(JSON.stringify(staged)).not.toContain('roadmap');
    expect(await loadStaged(storage, UPLOAD)).toEqual(staged);
    expect(await storage.exists(uploadPath(UPLOAD))).toBe(false);
  });

  it('drops a meeting it cannot read and counts it', async () => {
    const files = syntheticExport().map((file) =>
      file.name.includes('meeting-metadata-01FAKEKLANT') ? { ...file, data: '{}' } : file,
    );
    const staged = await upload(files);
    expect(staged.unreadable).toBe(1);
    expect(staged.meetings.map((m) => m.id)).toEqual([planning?.id]);
    expect(await readdir(storage.absolutePath(`imports/${UPLOAD}/meetings`))).toEqual([
      planning?.id,
    ]);
  });

  it('removes everything when the archive is refused', async () => {
    await storage.write(uploadPath(UPLOAD), tarGz([{ name: '../x/transcript.json', data: '{}' }]));
    await expect(stageExport(storage, UPLOAD, LIMITS)).rejects.toThrow('unsafe');
    expect(await storage.exists(`imports/${UPLOAD}`)).toBe(false);
  });

  it('removes one meeting or the whole import', async () => {
    await upload();
    await removeStagedMeeting(storage, UPLOAD, planning?.id ?? '');
    expect(await readdir(storage.absolutePath(`imports/${UPLOAD}/meetings`))).toEqual([klant?.id]);
    await removeImport(storage, UPLOAD);
    expect(await loadStaged(storage, UPLOAD)).toBeUndefined();
  });

  it('removes imports nobody touched for a while', async () => {
    await upload();
    const other = '5c8d3a52-0000-4000-8000-000000000002';
    await storage.write(`imports/${other}/manifest.json`, new TextEncoder().encode('{}'));
    const old = new Date('2026-01-01T00:00:00Z');
    await utimes(storage.absolutePath(`imports/${other}`), old, old);
    expect(
      await removeStaleImports(storage, 7 * 86_400_000, new Date('2026-10-01T00:00:00Z')),
    ).toBe(1);
    expect(await readdir(storage.absolutePath('imports'))).toEqual([UPLOAD]);
  });
});

describe('uploading in chunks', () => {
  it('stores numbered parts, stops at the limit and joins them', async () => {
    const storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'om-chunks-')));
    try {
      const chunks = importChunks(storage, UPLOAD, 10);
      await chunks.save(1, Readable.from([Buffer.from('world')]));
      await chunks.save(0, Readable.from([Buffer.from('hello')]));
      expect(await chunks.received()).toEqual([0, 1]);
      await expect(chunks.save(2, Readable.from([Buffer.from('!')]))).rejects.toThrow('too large');
      expect(await chunks.assemble(2, uploadPath(UPLOAD))).toBe(10);
    } finally {
      await rm(storage.root, { recursive: true, force: true });
    }
  });
});
