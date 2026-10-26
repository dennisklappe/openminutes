import { describe, expect, it, vi } from 'vitest';
import { archiveProblem, chunkRanges, formatSize, uploadChunks } from './upload.js';

describe('chunkRanges', () => {
  it('cuts a file into chunks with a shorter last one', () => {
    expect(chunkRanges(25, 10)).toEqual([
      { index: 0, start: 0, end: 10 },
      { index: 1, start: 10, end: 20 },
      { index: 2, start: 20, end: 25 },
    ]);
  });

  it('gives an exact multiple no empty chunk', () => {
    expect(chunkRanges(20, 10)).toHaveLength(2);
  });
});

describe('archiveProblem', () => {
  const max = 1024 ** 3;
  it.each(['export.tar.gz', 'Export.TGZ', 'data.zip'])('accepts %s', (name) => {
    expect(archiveProblem({ name, size: 5 }, max)).toBeUndefined();
  });

  it('refuses other files, empty files and files over the limit', () => {
    expect(archiveProblem({ name: 'notes.pdf', size: 5 }, max)).toContain('.tar.gz or .zip');
    expect(archiveProblem({ name: 'a.zip', size: 0 }, max)).toBe('That file is empty.');
    expect(archiveProblem({ name: 'a.zip', size: max + 1 }, max)).toContain('1.0 GB');
  });

  it('formats sizes', () => {
    expect(formatSize(300 * 1024 ** 2)).toBe('300 MB');
    expect(formatSize(10 * 1024 ** 3)).toBe('10 GB');
  });
});

describe('uploadChunks', () => {
  const file = new Blob([new Uint8Array(25)]);
  const wait = () => Promise.resolve();

  it('sends every chunk in order and reports the bytes sent', async () => {
    const sent: [number, number][] = [];
    const progress: number[] = [];
    const count = await uploadChunks(file, 10, {
      send: (index, body) => {
        sent.push([index, body.size]);
        return Promise.resolve();
      },
      onProgress: (bytes) => progress.push(bytes),
      wait,
    });
    expect(count).toBe(3);
    expect(sent).toEqual([
      [0, 10],
      [1, 10],
      [2, 5],
    ]);
    expect(progress).toEqual([10, 20, 25]);
  });

  it('retries a failing chunk', async () => {
    const send = vi
      .fn<(index: number, body: Blob) => Promise<void>>()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValue(undefined);
    await uploadChunks(file, 100, { send, onProgress: () => undefined, wait });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempts and does not retry a client error', async () => {
    const down = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { status: 503 }));
    await expect(
      uploadChunks(file, 100, { send: down, onProgress: () => undefined, wait }),
    ).rejects.toThrow('x');
    expect(down).toHaveBeenCalledTimes(3);
    const tooBig = vi.fn().mockRejectedValue(Object.assign(new Error('big'), { status: 413 }));
    await expect(
      uploadChunks(file, 100, { send: tooBig, onProgress: () => undefined, wait }),
    ).rejects.toThrow('big');
    expect(tooBig).toHaveBeenCalledTimes(1);
  });
});
