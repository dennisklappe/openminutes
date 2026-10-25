import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';

const TOKEN = 'e2e-token';
const received = [];

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  if (req.url === '/received') return send(res, 200, received);
  if (req.headers.authorization !== `Bearer ${TOKEN}`)
    return send(res, 401, { detail: 'bad token' });
  if (req.url === '/health') return send(res, 200, { status: 'ok', model: 'fake' });
  if (req.url === '/transcribe' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    received.push({ bytes: body.length, ogg: body.includes('OggS') });
    return send(res, 200, {
      language: 'en',
      segments: [
        { startMs: 1500, endMs: 3500, text: 'Hello from the fake meeting.', confidence: 0.99 },
        {
          startMs: 3000,
          endMs: 4000,
          text: 'This transcript.',
          words: [
            { startMs: 3000, endMs: 3400, text: 'This' },
            { startMs: 3500, endMs: 3900, text: 'transcript.' },
          ],
        },
        {
          startMs: 5500,
          endMs: 7500,
          text: 'Came from the stub.',
          words: [
            { startMs: 5500, endMs: 5900, text: 'Came' },
            { startMs: 6000, endMs: 6400, text: 'from' },
            { startMs: 6500, endMs: 6900, text: 'the' },
            { startMs: 7000, endMs: 7500, text: 'stub.' },
          ],
        },
      ],
    });
  }
  return send(res, 404, { detail: 'not found' });
}).listen(8000);
