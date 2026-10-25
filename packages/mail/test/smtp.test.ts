import { SMTPServer } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import { afterEach, describe, expect, it } from 'vitest';
import { createMailProvider } from '../src/index.js';
import { message } from './helpers.js';

interface Received {
  mail: ParsedMail;
  rcpt: string[];
}

let server: SMTPServer | undefined;

async function start(options: { auth?: boolean } = {}) {
  const received: Received[] = [];
  server = new SMTPServer({
    authOptional: !options.auth,
    allowInsecureAuth: true,
    disabledCommands: ['STARTTLS'],
    onAuth(auth, _session, callback) {
      if (auth.username === 'user' && auth.password === 'pw') callback(null, { user: 'user' });
      else callback(new Error('Invalid login'));
    },
    onData(stream, session, callback) {
      void simpleParser(stream).then((mail) => {
        received.push({ mail, rcpt: session.envelope.rcptTo.map((r) => r.address) });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.server.address() as { port: number };
  return { port, received };
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server)
      server.close(() => {
        resolve();
      });
    else resolve();
  });
  server = undefined;
});

describe('smtp', () => {
  it('delivers plain and html parts to every recipient', async () => {
    const { port, received } = await start();
    const provider = createMailProvider('smtp', { host: '127.0.0.1', port });

    const result = await provider.send(message);

    expect(result.id).toBeTruthy();
    expect(received).toHaveLength(1);
    expect(received[0]?.rcpt).toEqual(['ada@example.com', 'grace@example.com']);
    expect(received[0]?.mail.subject).toBe('Minutes: Weekly sync');
    expect(received[0]?.mail.text).toContain('Plain body');
    expect(received[0]?.mail.html).toContain('HTML body');
    expect(received[0]?.mail.from?.text).toBe('"Minutes Bot" <bot@example.com>');
  });

  it('authenticates and tests the connection without sending', async () => {
    const { port, received } = await start({ auth: true });
    const provider = createMailProvider('smtp', {
      host: '127.0.0.1',
      port,
      username: 'user',
      password: 'pw',
    });
    await expect(provider.test()).resolves.toEqual({ detail: 'connected to 127.0.0.1' });
    expect(received).toHaveLength(0);
  });

  it('maps a rejected login to an auth error', async () => {
    const { port } = await start({ auth: true });
    const provider = createMailProvider('smtp', {
      host: '127.0.0.1',
      port,
      username: 'user',
      password: 'wrong',
    });
    await expect(provider.test()).rejects.toMatchObject({ code: 'auth' });
  });
});
