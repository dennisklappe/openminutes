import type { Readable } from 'node:stream';

export interface ByteRange {
  start: number;
  end: number;
}

export interface ObjectStore {
  upload(key: string, filePath: string): Promise<void>;
  download(key: string, filePath: string): Promise<void>;
  read(key: string, range?: ByteRange): Promise<Readable>;
  size(key: string): Promise<number | undefined>;
  remove(key: string): Promise<void>;
}
