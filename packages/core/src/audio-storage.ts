import type { Readable } from 'node:stream';
import type { ObjectStore, ByteRange } from './object-store.js';
import { S3Storage, s3ConfigSchema } from './s3-storage.js';
import { loadS3Config, loadStorageBackend } from './storage-config.js';
import type { SettingsStore } from './settings.js';
import type { LocalStorage } from './storage.js';

export class AudioStorage {
  constructor(
    readonly local: LocalStorage,
    private readonly remote?: ObjectStore,
  ) {}

  async size(path: string): Promise<number | undefined> {
    if (await this.local.exists(path)) return this.local.size(path);
    return this.remote?.size(path);
  }

  async read(path: string, range?: ByteRange): Promise<Readable> {
    if (this.remote && !(await this.local.exists(path))) return this.remote.read(path, range);
    return this.local.read(path, range);
  }

  async ensureLocal(path: string): Promise<string> {
    const full = this.local.absolutePath(path);
    if (this.remote && !(await this.local.exists(path))) await this.remote.download(path, full);
    return full;
  }

  async archive(path: string): Promise<void> {
    if (!this.remote || !(await this.local.exists(path))) return;
    await this.remote.upload(path, this.local.absolutePath(path));
    await this.local.remove(path);
  }

  async remove(path: string): Promise<void> {
    await Promise.all([this.local.remove(path), this.remote?.remove(path)]);
  }

  async removeFolder(path: string): Promise<void> {
    await Promise.all([this.local.removeDirectory(path), this.remote?.remove(`${path}/`)]);
  }
}

export async function loadAudioStorage(
  settings: SettingsStore,
  local: LocalStorage,
): Promise<AudioStorage> {
  if ((await loadStorageBackend(settings)) !== 's3') return new AudioStorage(local);
  return new AudioStorage(local, new S3Storage(s3ConfigSchema.parse(await loadS3Config(settings))));
}
