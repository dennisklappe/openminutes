import { createServer } from 'node:http';

const KEY = 'e2e-llm-key';
const received = [];

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  if (req.url === '/received') return send(res, 200, received);
  if (req.headers.authorization !== `Bearer ${KEY}`) {
    return send(res, 401, { error: { message: 'bad key' } });
  }
  if (req.url === '/v1/models') return send(res, 200, { data: [] });
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { messages } = JSON.parse(body);
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    received.push({ system, user });
    const content = system.startsWith('You are given excerpt')
      ? `Notes: ${user.slice(0, 10)}`
      : `## Summary\n\nStub summary for: ${system.slice(0, 24)}`;
    return send(res, 200, { choices: [{ message: { content } }] });
  }
  return send(res, 404, { error: { message: 'not found' } });
}).listen(8000);
