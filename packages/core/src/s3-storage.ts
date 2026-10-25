import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { z } from 'zod';
import type { ByteRange, ObjectStore } from './object-store.js';

export const s3ConfigSchema = z.object({
  endpoint: z.url().optional(),
  bucket: z.string().min(1),
  region: z.string().min(1).default('us-east-1'),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

export type S3Config = z.infer<typeof s3ConfigSchema>;

export class StorageError extends Error {}

const NOT_FOUND = new Set(['NotFound', 'NoSuchKey']);

export class S3Storage implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      ...(config.endpoint && { endpoint: config.endpoint, forcePathStyle: true }),
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async upload(key: string, filePath: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: (await stat(filePath)).size,
      }),
    );
  }

  async download(key: string, filePath: string): Promise<void> {
    const partial = `${filePath}.${randomUUID()}.part`;
    await mkdir(dirname(filePath), { recursive: true });
    try {
      await pipeline(await this.read(key), createWriteStream(partial));
      await rename(partial, filePath);
    } finally {
      await rm(partial, { force: true });
    }
  }

  async read(key: string, range?: ByteRange): Promise<Readable> {
    const { Body } = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range && { Range: `bytes=${range.start}-${range.end}` }),
      }),
    );
    if (!(Body instanceof Readable)) throw new StorageError(`Object ${key} has no readable body`);
    return Body;
  }

  async size(key: string): Promise<number | undefined> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch (error) {
      if (error instanceof S3ServiceException && NOT_FOUND.has(error.name)) return undefined;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async probe(): Promise<void> {
    const key = `.openminutes-probe/${randomUUID()}`;
    const body = Buffer.from(randomUUID());
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body }));
    try {
      const echoed = await buffer(await this.read(key));
      if (!echoed.equals(body))
        throw new StorageError('The bucket returned different data than was written');
    } finally {
      await this.remove(key);
    }
  }
}
