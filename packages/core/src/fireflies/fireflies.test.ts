import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SYNTHETIC_AUDIO,
  SYNTHETIC_MEETINGS,
  syntheticExport,
  tarGz,
  zipArchive,
  type ArchiveFile,
} from '../testing/fireflies-export.js';
import { ArchiveError, extractExport } from './extract.js';
import { readFirefliesMeeting } from './parse.js';

const LIMITS = { maxBytes: 10_000_000, maxEntries: 100 };
const [planning, klant] = SYNTHETIC_MEETINGS;

describe('Fireflies export', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'om-fireflies-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  async function unpack(archive: Buffer, limits = LIMITS) {
    const file = join(root, 'upload.bin');
    await writeFile(file, archive);
    const out = join(root, 'out');
    return { ids: await extractExport(file, out, limits), out };
  }

  describe.each([
    ['tar.gz', tarGz],
    ['zip', zipArchive],
  ])('%s', (_name, pack) => {
    it('keeps the meeting files under fixed names, one folder per Fireflies id', async () => {
      const { ids, out } = await unpack(pack(syntheticExport()));
      expect(ids.toSorted()).toEqual([planning?.id, klant?.id].toSorted());
      expect((await readdir(join(out, planning?.id ?? ''))).toSorted()).toEqual([
        'audio.mp3',
        'metadata.json',
      ]);
      expect(await readFile(join(out, planning?.id ?? '', 'audio.mp3'))).toEqual(SYNTHETIC_AUDIO);
      expect(await readdir(out)).not.toContain('.unpacking');
    });

    it.each([
      ['a parent folder', '../evil/transcript.json'],
      ['an absolute path', '/etc/transcript.json'],
      ['a drive path', 'C:/x/transcript.json'],
    ])('refuses %s', async (_label, name) => {
      await expect(unpack(pack([{ name, data: '{}' }]))).rejects.toThrow(ArchiveError);
    });

    it('refuses more files than the limit', async () => {
      const files = Array.from({ length: 5 }, (_, i) => ({
        name: `f/${String(i)}.txt`,
        data: 'x',
      }));
      await expect(unpack(pack(files), { ...LIMITS, maxEntries: 3 })).rejects.toThrow(
        'too many files',
      );
    });

    it('refuses an archive that unpacks past the size limit', async () => {
      const big: ArchiveFile = { name: 'm/audio.mp3', data: Buffer.alloc(5000) };
      await expect(unpack(pack([big]), { ...LIMITS, maxBytes: 1000 })).rejects.toThrow(
        'larger than the import limit',
      );
    });
  });

  it.each([
    ['a symlink', '2'],
    ['a hard link', '1'],
    ['a device', '3'],
    ['a fifo', '6'],
  ])('refuses %s in a tar', async (_label, type) => {
    await expect(unpack(tarGz([{ name: 'm/audio.mp3', type }]))).rejects.toThrow('link, a device');
  });

  it('refuses a symlink in a zip', async () => {
    await expect(
      unpack(zipArchive([{ name: 'm/audio.mp3', data: '/etc/passwd', mode: 0o120777 }])),
    ).rejects.toThrow('link, a device');
  });

  it('reads long names from pax headers and ignores files it does not need', async () => {
    const folder = 'a'.repeat(120);
    const { ids } = await unpack(
      tarGz([
        { name: `${folder}/transcript.json`, data: '{}' },
        { name: `${folder}/meeting-metadata-01FAKELONGNAME0001.txt`, data: '{}' },
        { name: `${folder}/video.mp4`, data: 'video' },
        { name: `${folder}/notes.exe`, data: 'x' },
      ]),
    );
    expect(ids).toEqual(['01FAKELONGNAME0001']);
  });

  it('rejects a file that is neither gzip nor zip', async () => {
    await expect(unpack(Buffer.from('just some text'))).rejects.toThrow('.tar.gz or .zip');
  });

  it('rejects a damaged tar', async () => {
    const good = tarGz(syntheticExport());
    await expect(unpack(good.subarray(0, 40))).rejects.toThrow();
  });

  describe('readFirefliesMeeting', () => {
    async function read(index: number) {
      const meeting = SYNTHETIC_MEETINGS[index];
      const { out } = await unpack(tarGz(syntheticExport()));
      return readFirefliesMeeting(join(out, meeting?.id ?? ''), meeting?.id ?? '');
    }

    it('maps the title, timings and attendees and sees the audio', async () => {
      const meeting = await read(0);
      expect(meeting).toMatchObject({
        title: 'Weekly planning',
        url: `https://app.fireflies.ai/view/${planning?.id ?? ''}`,
        attendees: ['alice@example.com', 'bob@example.com'],
        durationMs: 12 * 60_000,
        hasAudio: true,
      });
      expect(meeting.startedAt.toISOString()).toBe('2026-10-01T09:00:00.000Z');
      expect(meeting.endedAt.toISOString()).toBe('2026-10-01T09:12:00.000Z');
      expect(meeting).not.toHaveProperty('segments');
      expect(meeting).not.toHaveProperty('summary');
    });

    it('writes the attendee addresses in lower case, once each', async () => {
      const dir = join(root, 'mixed');
      await mkdir(dir);
      await writeFile(
        join(dir, 'metadata.json'),
        JSON.stringify({
          attendees: [' Alice@Example.COM ', 'alice@example.com', 'Bob@Example.com'],
          meetingTitle: 'Mixed case',
          meetingStartTime: '2026-10-01T09:00:00.000Z',
          meetingEndTime: '2026-10-01T09:30:00.000Z',
        }),
      );
      const meeting = await readFirefliesMeeting(dir, 'mixed');
      expect(meeting.attendees).toEqual(['alice@example.com', 'bob@example.com']);
    });

    it('marks a meeting without a recording', async () => {
      expect((await read(1)).hasAudio).toBe(false);
    });

    it('keeps no transcript or summary files from the archive', async () => {
      const { out } = await unpack(tarGz(syntheticExport()));
      expect((await readdir(join(out, klant?.id ?? ''))).toSorted()).toEqual(['metadata.json']);
    });

    it('falls back to a generic title and the scheduled length', async () => {
      const { out } = await unpack(
        tarGz([
          {
            name: 'm/meeting-metadata-01FAKEBARE00000001.txt',
            data: JSON.stringify({
              meetingStartTime: '2026-10-03T08:00:00.000Z',
              meetingEndTime: '2026-10-03T08:30:00.000Z',
            }),
          },
        ]),
      );
      const meeting = await readFirefliesMeeting(
        join(out, '01FAKEBARE00000001'),
        '01FAKEBARE00000001',
      );
      expect(meeting).toMatchObject({
        title: 'Fireflies meeting',
        durationMs: 30 * 60_000,
        attendees: [],
      });
    });
  });
});
