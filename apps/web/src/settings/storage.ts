import {
  loadS3Config,
  loadStorageBackend,
  S3Storage,
  s3ConfigSchema,
  saveStorage,
  type LocalStorage,
  type SettingsStore,
} from '@openminutes/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ProviderTestDto, StorageSettingsDto } from '../dto.js';

interface StorageDeps {
  settings: SettingsStore;
  storage: LocalStorage;
}

const MAX_RETENTION_DAYS = 3650;

const s3Input = z.object({
  endpoint: z.string().trim(),
  bucket: z.string().trim(),
  region: z.string().trim(),
  accessKeyId: z.string().trim(),
  secretAccessKey: z.string().optional(),
});

const input = z.object({
  backend: z.enum(['local', 's3']),
  s3: s3Input,
  retentionDays: z.int().min(1).max(MAX_RETENTION_DAYS).nullable(),
});

class InvalidStorageSettingsError extends Error {}

const blankToUndefined = (value: string | undefined) => (value ? value : undefined);

export function storageRoutes({ settings, storage }: StorageDeps): Hono {
  const routes = new Hono();

  routes.onError((error, c) => {
    if (error instanceof InvalidStorageSettingsError) return c.json({ error: error.message }, 400);
    throw error;
  });

  const read = async (): Promise<StorageSettingsDto> => {
    const [backend, s3, retention] = await Promise.all([
      loadStorageBackend(settings),
      loadS3Config(settings),
      settings.get('retention.audio_days'),
    ]);
    return {
      backend,
      localPath: storage.root,
      s3: {
        endpoint: s3.endpoint ?? '',
        bucket: s3.bucket ?? '',
        region: s3.region ?? '',
        accessKeyId: s3.accessKeyId ?? '',
        hasSecretAccessKey: s3.secretAccessKey !== undefined,
      },
      retentionDays: retention === undefined ? null : Number(retention),
    };
  };

  const resolveS3 = async (body: z.infer<typeof s3Input>) => {
    const stored = await loadS3Config(settings);
    const parsed = s3ConfigSchema.safeParse({
      endpoint: blankToUndefined(body.endpoint),
      bucket: body.bucket,
      region: blankToUndefined(body.region),
      accessKeyId: body.accessKeyId,
      secretAccessKey: blankToUndefined(body.secretAccessKey) ?? stored.secretAccessKey,
    });
    if (!parsed.success) {
      throw new InvalidStorageSettingsError(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    return parsed.data;
  };

  const parse = async (request: Request) => {
    const body = input.safeParse(await request.json().catch(() => null));
    if (!body.success) throw new InvalidStorageSettingsError('Invalid storage settings');
    return body.data;
  };

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = await parse(c.req.raw);
    if (body.backend === 's3') {
      await saveStorage(settings, 's3', await resolveS3(body.s3));
    } else {
      await saveStorage(settings, 'local');
    }
    if (body.retentionDays === null) await settings.delete('retention.audio_days');
    else await settings.set('retention.audio_days', String(body.retentionDays));
    return c.json(await read());
  });

  routes.post('/test', async (c) => {
    const body = await parse(c.req.raw);
    try {
      await new S3Storage(await resolveS3(body.s3)).probe();
      return c.json<ProviderTestDto>({ ok: true, detail: 'wrote, read and deleted a test object' });
    } catch (error) {
      if (error instanceof InvalidStorageSettingsError) throw error;
      return c.json<ProviderTestDto>({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return routes;
}
