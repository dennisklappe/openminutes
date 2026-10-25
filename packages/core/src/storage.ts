import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export class LocalStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  absolutePath(relativePath: string): string {
    const full = resolve(this.root, relativePath);
    if (!full.startsWith(this.root + sep)) throw new Error('Path escapes the storage root');
    return full;
  }

  async ensureDirectory(relativePath: string): Promise<string> {
    const full = this.absolutePath(relativePath);
    await mkdir(full, { recursive: true });
    return full;
  }

  async size(relativePath: string): Promise<number> {
    return (await stat(this.absolutePath(relativePath))).size;
  }

  async write(relativePath: string, data: Uint8Array): Promise<void> {
    const full = this.absolutePath(relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async remove(relativePath: string): Promise<void> {
    await rm(this.absolutePath(relativePath), { force: true });
  }

  async removeDirectory(relativePath: string): Promise<void> {
    await rm(this.absolutePath(relativePath), { recursive: true, force: true });
  }

  async exists(relativePath: string): Promise<boolean> {
    return stat(this.absolutePath(relativePath)).then(
      () => true,
      () => false,
    );
  }

  read(relativePath: string, range?: { start: number; end: number }): ReadStream {
    return createReadStream(this.absolutePath(relativePath), range);
  }
}
