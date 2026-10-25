import type { z } from 'zod';
import { s3ConfigSchema, type S3Config } from './s3-storage.js';
import type { SettingsStore } from './settings.js';

const storedS3Schema = s3ConfigSchema.partial();

export type StoredS3Config = z.infer<typeof storedS3Schema>;
export type StorageBackend = 'local' | 's3';

export async function loadS3Config(settings: SettingsStore): Promise<StoredS3Config> {
  const stored = await settings.get('storage.s3');
  return stored ? storedS3Schema.parse(JSON.parse(stored)) : {};
}

export async function loadStorageBackend(settings: SettingsStore): Promise<StorageBackend> {
  return (await settings.get('storage.backend')) === 's3' ? 's3' : 'local';
}

export async function saveStorage(
  settings: SettingsStore,
  backend: StorageBackend,
  s3?: S3Config,
): Promise<void> {
  if (s3) await settings.set('storage.s3', JSON.stringify(s3));
  await settings.set('storage.backend', backend);
}
