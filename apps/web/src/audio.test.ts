import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioStorage, LocalStorage } from '@openminutes/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { audioResponse } from './audio.js';

describe('audioResponse', () => {
  let storage: AudioStorage;
  beforeAll(async () => {
    const local = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-audio-')));
    await local.write('a.opus', Buffer.from('0123456789'));
    await local.write('big.opus', Buffer.alloc(8 * 1024 * 1024, 1));
    storage = new AudioStorage(local);
  });

  it('answers open ended, suffix and bounded ranges with 206', async () => {
    const open = await audioResponse(storage, 'a.opus', 'bytes=4-');
    expect(open.status).toBe(206);
    expect(open.headers.get('content-range')).toBe('bytes 4-9/10');
    expect(await open.text()).toBe('456789');
    const suffix = await audioResponse(storage, 'a.opus', 'bytes=-3');
    expect(suffix.headers.get('content-range')).toBe('bytes 7-9/10');
    const bounded = await audioResponse(storage, 'a.opus', 'bytes=2-100');
    expect(bounded.headers.get('content-range')).toBe('bytes 2-9/10');
    expect((await audioResponse(storage, 'a.opus', 'bytes=10-')).status).toBe(416);
    expect((await audioResponse(storage, 'missing.opus', undefined)).status).toBe(404);
  });

  it('stops reading the file when the client goes away', async () => {
    const response = await audioResponse(storage, 'big.opus', 'bytes=0-');
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect((first?.value as Uint8Array | undefined)?.length).toBeGreaterThan(0);
    await reader?.cancel();
    expect((await reader?.read())?.done).toBe(true);
  });
});
