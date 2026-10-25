import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buffer } from 'node:stream/consumers';

export interface FakeS3 {
  endpoint: string;
  objects: Map<string, Buffer>;
  close(): Promise<void>;
}

export interface FakeS3Options {
  bucket: string;
  accessKeyId: string;
}

function fail(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, { 'content-type': 'application/xml' });
  response.end(
    `<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`,
  );
}

function slice(data: Buffer, header: string | undefined): { status: number; body: Buffer } {
  const match = /^bytes=(\d+)-(\d+)$/.exec(header ?? '');
  if (!match) return { status: 200, body: data };
  return { status: 206, body: data.subarray(Number(match[1]), Number(match[2]) + 1) };
}

export async function startFakeS3({ bucket, accessKeyId }: FakeS3Options): Promise<FakeS3> {
  const objects = new Map<string, Buffer>();

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const path = decodeURIComponent(request.url ?? '').split('?')[0] ?? '';
    const [, requestBucket = '', ...rest] = path.split('/');
    const key = rest.join('/');
    const data = objects.get(key);

    if (!request.headers.authorization?.includes(`Credential=${accessKeyId}/`)) {
      fail(response, 403, 'InvalidAccessKeyId');
    } else if (requestBucket !== bucket) {
      fail(response, 404, 'NoSuchBucket');
    } else if (request.method === 'PUT') {
      objects.set(key, await buffer(request));
      response.writeHead(200).end();
    } else if (request.method === 'DELETE') {
      objects.delete(key);
      response.writeHead(204).end();
    } else if (request.method === 'HEAD') {
      response.writeHead(data ? 200 : 404, { 'content-length': data?.length ?? 0 }).end();
    } else if (request.method === 'GET' && data) {
      const { status, body } = slice(data, request.headers.range);
      response.writeHead(status, { 'content-length': body.length }).end(body);
    } else if (request.method === 'GET') {
      fail(response, 404, 'NoSuchKey');
    } else {
      fail(response, 405, 'MethodNotAllowed');
    }
  };

  const server = createServer((request, response) => {
    void handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    objects,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}
