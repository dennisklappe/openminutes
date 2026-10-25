import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { longFetch } from './long-fetch.js';

describe('longFetch', () => {
  const received: { type: string; size: number }[] = [];
  const server = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (part: Buffer) => parts.push(part));
    request.on('end', () => {
      const body = Buffer.concat(parts);
      received.push({ type: request.headers['content-type'] ?? '', size: body.length });
      response.setHeader('content-type', 'application/json');
      response.end('{"ok":true}');
    });
  });
  let url = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  afterAll(() => {
    server.close();
  });

  it('posts a multipart audio form like the built-in fetch', async () => {
    const form = new FormData();
    form.set('file', new Blob(['x'.repeat(5000)], { type: 'audio/ogg' }), 'a.ogg');
    form.set('language', 'nl');
    const response = await longFetch(url, { method: 'POST', body: form });

    expect(await response.json()).toEqual({ ok: true });
    expect(received[0]?.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(received[0]?.size).toBeGreaterThan(5000);
  });
});
