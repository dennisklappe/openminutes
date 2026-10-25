import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type RequestListener } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { fixturePage } from './fixture-pages.js';

const { PORT = '8080', TLS_CERT, TLS_KEY } = process.env;

const events: unknown[] = [];

async function readBody(req: Parameters<RequestListener>[0]): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const handler: RequestListener = (req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  const url = new URL(req.url ?? '/', `https://${host}`);
  if (url.pathname === '/__events') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(events));
    return;
  }
  if (url.pathname === '/__event' && req.method === 'POST') {
    void readBody(req)
      .then((body) => {
        events.push(JSON.parse(body));
        res.writeHead(204).end();
      })
      .catch(() => res.writeHead(400).end());
    return;
  }
  // Meet links are reduced to their code when a meeting is created, so the fixture options travel in a
  // lookup id instead: /lookup/<label>-<hex of the query string>. The page reads its options from the query.
  const lookup = /^\/lookup\/(?:[a-z0-9]+-)?([0-9a-f]+)$/.exec(url.pathname)?.[1];
  if (url.hostname === 'meet.google.com' && lookup && !url.search) {
    res.writeHead(302, {
      location: `/abc-defg-hij?${Buffer.from(lookup, 'hex').toString('utf8')}`,
    });
    res.end();
    return;
  }
  const page = fixturePage(url);
  res.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
};

const server =
  TLS_CERT && TLS_KEY
    ? createHttpsServer({ cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) }, handler)
    : createHttpServer(handler);

server.listen(Number(PORT), () => {
  console.log(`fixtures listening on ${PORT}`);
});
