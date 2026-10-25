import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalStorage } from './storage.js';

describe('LocalStorage', () => {
  it('creates directories and reads byte ranges', async () => {
    const storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-storage-')));
    const directory = await storage.ensureDirectory('meetings/a');
    await writeFile(join(directory, 'audio.opus'), 'abcdef');

    expect(await storage.size('meetings/a/audio.opus')).toBe(6);
    const chunks: Buffer[] = [];
    for await (const chunk of storage.read('meetings/a/audio.opus', { start: 1, end: 3 })) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).toString()).toBe('bcd');
  });

  it('refuses paths outside the root', () => {
    const storage = new LocalStorage('/data');
    expect(() => storage.absolutePath('../etc/passwd')).toThrow('escapes');
    expect(() => storage.absolutePath('/etc/passwd')).toThrow('escapes');
  });
});
