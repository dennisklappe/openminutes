import { Readable } from 'node:stream';
import type { AudioStorage } from '@openminutes/core';

export async function audioResponse(
  storage: AudioStorage,
  path: string,
  rangeHeader: string | undefined,
  downloadName?: string,
): Promise<Response> {
  const size = await storage.size(path);
  if (size === undefined) return Response.json({ error: 'Audio not found' }, { status: 404 });
  const headers: Record<string, string> = {
    'content-type': 'audio/ogg',
    'accept-ranges': 'bytes',
    ...(downloadName && { 'content-disposition': `attachment; filename="${downloadName}"` }),
  };
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '');

  if (!match) {
    const body = Readable.toWeb(await storage.read(path)) as ReadableStream;
    return new Response(body, { headers: { ...headers, 'content-length': String(size) } });
  }

  const [, from = '', to = ''] = match;
  const start = from === '' ? Math.max(size - Number(to), 0) : Number(from);
  const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }

  const body = Readable.toWeb(await storage.read(path, { start, end })) as ReadableStream;
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`,
    },
  });
}
