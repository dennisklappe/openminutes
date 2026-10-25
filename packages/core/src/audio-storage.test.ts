import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AudioStorage } from './audio-storage.js';
import { S3Storage } from './s3-storage.js';
import { LocalStorage } from './storage.js';
import { startFakeS3, type FakeS3 } from './testing/fake-s3.js';

const credentials = { accessKeyId: 'AKIATEST', secretAccessKey: 'shh-secret' };

describe('AudioStorage with an S3 archive', () => {
  let s3: FakeS3;
  let local: LocalStorage;
  let storage: AudioStorage;
  const config = () => ({
    endpoint: s3.endpoint,
    bucket: 'openminutes',
    region: 'us-east-1',
    ...credentials,
  });

  beforeAll(async () => {
    s3 = await startFakeS3({ bucket: 'openminutes', accessKeyId: credentials.accessKeyId });
  });
  afterAll(() => s3.close());
  beforeEach(async () => {
    s3.objects.clear();
    local = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-audio-')));
    storage = new AudioStorage(local, new S3Storage(config()));
    await local.write('meetings/a/audio.opus', Buffer.from('0123456789'));
  });

  it('moves a file to the bucket and still serves it', async () => {
    await storage.archive('meetings/a/audio.opus');

    expect(await local.exists('meetings/a/audio.opus')).toBe(false);
    expect(s3.objects.get('meetings/a/audio.opus')?.toString()).toBe('0123456789');
    expect(await storage.size('meetings/a/audio.opus')).toBe(10);
    const range = await storage.read('meetings/a/audio.opus', { start: 2, end: 4 });
    expect((await buffer(range)).toString()).toBe('234');
  });

  it('downloads an archived file when a local copy is needed', async () => {
    await storage.archive('meetings/a/audio.opus');

    const path = await storage.ensureLocal('meetings/a/audio.opus');
    expect(await readFile(path, 'utf8')).toBe('0123456789');
  });

  it('removes a file from both places', async () => {
    await storage.archive('meetings/a/audio.opus');
    await local.write('meetings/a/audio.opus', Buffer.from('copy'));

    await storage.remove('meetings/a/audio.opus');

    expect(await storage.size('meetings/a/audio.opus')).toBeUndefined();
    expect(s3.objects.size).toBe(0);
  });

  it('removes the folder of a meeting with the files left in it', async () => {
    await local.write('meetings/a/stray.part', Buffer.from('x'));
    s3.objects.set('meetings/a/', Buffer.alloc(0));

    await storage.removeFolder('meetings/a');

    expect(await local.exists('meetings/a')).toBe(false);
    expect(s3.objects.has('meetings/a/')).toBe(false);
  });

  it('leaves files alone without a bucket and ignores missing files', async () => {
    const plain = new AudioStorage(local);
    await plain.archive('meetings/a/audio.opus');
    await plain.archive('meetings/a/missing.opus');
    expect(await local.exists('meetings/a/audio.opus')).toBe(true);
    expect(await plain.ensureLocal('meetings/a/audio.opus')).toBe(
      local.absolutePath('meetings/a/audio.opus'),
    );
  });

  it('probes the bucket and reports bad credentials', async () => {
    await new S3Storage(config()).probe();
    expect(s3.objects.size).toBe(0);
    await expect(new S3Storage({ ...config(), accessKeyId: 'WRONG' }).probe()).rejects.toThrow();
    await expect(new S3Storage({ ...config(), bucket: 'nope' }).probe()).rejects.toThrow();
  });

  it('uploads and downloads whole files', async () => {
    const source = join(await mkdtemp(join(tmpdir(), 'openminutes-s3-')), 'in.bin');
    await writeFile(source, 'payload');
    const store = new S3Storage(config());
    await store.upload('x/in.bin', source);
    await store.download('x/in.bin', `${source}.copy`);
    expect(await readFile(`${source}.copy`, 'utf8')).toBe('payload');
  });
});
