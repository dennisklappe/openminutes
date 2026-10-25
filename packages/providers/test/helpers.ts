import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Chunk, Deps, FetchLike, Media } from '../src/types.js';

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function scriptedFetch(...responses: (Response | Error)[]): {
  fetch: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetch: FetchLike = (url, init = {}) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) return Promise.reject(new Error(`unexpected request to ${url}`));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { fetch, calls };
}

export function singleChunkMedia(durationMs: number): Media {
  return {
    prepare: (path) =>
      Promise.resolve({
        chunks: [{ path, offsetMs: 0, durationMs }],
        cleanup: () => Promise.resolve(),
      }),
  };
}

export function fixedMedia(chunks: Chunk[], onCleanup: () => void = () => undefined): Media {
  return {
    prepare: () =>
      Promise.resolve({
        chunks,
        cleanup: () => {
          onCleanup();
          return Promise.resolve();
        },
      }),
  };
}

export function deps(overrides: Partial<Deps>): Deps {
  return {
    fetch: () => Promise.reject(new Error('no fetch')),
    media: singleChunkMedia(1000),
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

export async function tempAudio(name = 'meeting.mp3', bytes = 'audio'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openminutes-test-'));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

export function bodyField(call: RecordedCall | undefined, field: string): unknown {
  const body = call?.init.body;
  if (!(body instanceof FormData)) throw new Error('expected multipart body');
  return body.get(field);
}

export function jsonBody(call: RecordedCall | undefined): unknown {
  const body = call?.init.body;
  if (typeof body !== 'string') throw new Error('expected JSON body');
  return JSON.parse(body);
}
