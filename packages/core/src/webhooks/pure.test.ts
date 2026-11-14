import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchesWebhookFilter, webhookFilterSchema, type WebhookMeetingFacts } from './filter.js';
import { generateWebhookSecret, signWebhook, verifyWebhookSignature } from './sign.js';
import { pinnedTransport } from './transport.js';
import { checkWebhookUrl, classifyAddress, type Resolver } from './url-guard.js';

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = '{"id":"1"}';

  it('signs "t.body" with hmac-sha256 and verifies it', () => {
    const header = signWebhook(secret, body, 1_800_000_000);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, body, header, { now: 1_800_000_000 })).toBe(true);
  });

  it('rejects another body, another secret or a broken header', () => {
    const header = signWebhook(secret, body, 1_800_000_000);
    const now = { now: 1_800_000_000 };
    expect(verifyWebhookSignature(secret, '{"id":"2"}', header, now)).toBe(false);
    expect(verifyWebhookSignature('whsec_other', body, header, now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'v1=abc', now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, 't=1800000000,v1=zz', now)).toBe(false);
  });

  it('accepts five minutes of clock difference and no more', () => {
    const header = signWebhook(secret, body, 1_800_000_000);
    expect(verifyWebhookSignature(secret, body, header, { now: 1_800_000_300 })).toBe(true);
    expect(verifyWebhookSignature(secret, body, header, { now: 1_799_999_700 })).toBe(true);
    expect(verifyWebhookSignature(secret, body, header, { now: 1_800_000_301 })).toBe(false);
    expect(verifyWebhookSignature(secret, body, header, { now: 1_799_999_699 })).toBe(false);
  });

  it('makes whsec_ secrets of 32 random bytes', () => {
    const { secret: made, prefix } = generateWebhookSecret();
    expect(made).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(prefix).toBe(made.slice(0, 10));
    expect(generateWebhookSecret().secret).not.toBe(made);
  });
});

describe('webhook filters', () => {
  const meeting: WebhookMeetingFacts = {
    title: 'Weekly sync with Acme',
    participants: [
      { name: 'Ada Lovelace', email: 'ada@acme.test' },
      { name: 'Alan Turing', email: null },
    ],
    company: 'Acme',
    platform: 'meet',
  };

  it('lets everything through without criteria', () => {
    expect(matchesWebhookFilter({}, meeting)).toBe(true);
    expect(matchesWebhookFilter(null, meeting)).toBe(true);
    expect(matchesWebhookFilter({ titleContains: [] }, meeting)).toBe(true);
  });

  it('matches title words case-insensitively, any of them', () => {
    expect(matchesWebhookFilter({ titleContains: ['WEEKLY'] }, meeting)).toBe(true);
    expect(matchesWebhookFilter({ titleContains: ['standup', 'sync'] }, meeting)).toBe(true);
    expect(matchesWebhookFilter({ titleContains: ['standup'] }, meeting)).toBe(false);
    expect(matchesWebhookFilter({ titleNotContains: ['acme'] }, meeting)).toBe(false);
    expect(matchesWebhookFilter({ titleNotContains: ['private'] }, meeting)).toBe(true);
  });

  it('matches participants on name or email', () => {
    expect(matchesWebhookFilter({ participantContains: ['turing'] }, meeting)).toBe(true);
    expect(matchesWebhookFilter({ participantContains: ['@acme.test'] }, meeting)).toBe(true);
    expect(matchesWebhookFilter({ participantContains: ['grace'] }, meeting)).toBe(false);
  });

  it('matches the exact company and the platform', () => {
    expect(matchesWebhookFilter({ companies: ['acme'] }, meeting)).toBe(true);
    expect(matchesWebhookFilter({ companies: ['Acme Inc'] }, meeting)).toBe(false);
    expect(matchesWebhookFilter({ companies: ['Acme'] }, { ...meeting, company: null })).toBe(
      false,
    );
    expect(matchesWebhookFilter({ platforms: ['meet', 'teams'] }, meeting)).toBe(true);
    expect(matchesWebhookFilter({ platforms: ['recording'] }, meeting)).toBe(false);
  });

  it('needs every given criterion to hold', () => {
    expect(matchesWebhookFilter({ titleContains: ['sync'], platforms: ['teams'] }, meeting)).toBe(
      false,
    );
    expect(
      matchesWebhookFilter(
        { titleContains: ['sync'], companies: ['ACME'], participantContains: ['ada'] },
        meeting,
      ),
    ).toBe(true);
  });

  it('validates and cleans filters from the API', () => {
    expect(webhookFilterSchema.parse({ titleContains: [' a ', 'a'], companies: [] })).toEqual({
      titleContains: ['a'],
    });
    expect(webhookFilterSchema.safeParse({ platforms: ['zoom'] }).success).toBe(false);
    expect(webhookFilterSchema.safeParse({ other: ['x'] }).success).toBe(false);
  });
});

describe('webhook URL guard', () => {
  const resolveTo =
    (...addresses: string[]): Resolver =>
    () =>
      Promise.resolve(
        addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      );

  it('classifies addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) {
      expect([address, classifyAddress(address)]).toEqual([address, 'public']);
    }
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
    ]) {
      expect([address, classifyAddress(address)]).toEqual([address, 'private']);
    }
    for (const address of [
      '169.254.169.254',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '100.100.100.200',
      'fe80::1',
      'ff02::1',
      '::',
      'fd00:ec2::254',
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      '64:ff9b::a9fe:a9fe',
      '2002:a9fe:a9fe::1',
      '::169.254.169.254',
      'not-an-ip',
    ]) {
      expect([address, classifyAddress(address)]).toEqual([address, 'blocked']);
    }
    expect(classifyAddress('172.32.0.1')).toBe('public');
    expect(classifyAddress('100.128.0.1')).toBe('public');
  });

  it('needs https unless private networks are allowed', async () => {
    const resolve = resolveTo('93.184.215.14');
    expect(
      await checkWebhookUrl('https://example.test/hook', { allowPrivate: false, resolve }),
    ).toMatchObject({ ok: true });
    expect(
      await checkWebhookUrl('http://example.test/hook', { allowPrivate: false, resolve }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('https') as unknown });
    expect(
      await checkWebhookUrl('http://example.test/hook', { allowPrivate: true, resolve }),
    ).toMatchObject({ ok: true });
    expect(
      await checkWebhookUrl('ftp://example.test/hook', { allowPrivate: true, resolve }),
    ).toMatchObject({ ok: false });
  });

  it('refuses credentials in the URL and allows any port', async () => {
    const resolve = resolveTo('93.184.215.14');
    expect(
      await checkWebhookUrl('https://user:pass@example.test/', { allowPrivate: false, resolve }),
    ).toMatchObject({ ok: false });
    expect(
      await checkWebhookUrl('https://example.test:8443/x', { allowPrivate: false, resolve }),
    ).toMatchObject({ ok: true });
  });

  it('checks every resolved address', async () => {
    const mixed = resolveTo('93.184.215.14', '10.0.0.5');
    expect(
      await checkWebhookUrl('https://example.test/', { allowPrivate: false, resolve: mixed }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('10.0.0.5') as unknown });
    expect(
      await checkWebhookUrl('https://example.test/', { allowPrivate: true, resolve: mixed }),
    ).toMatchObject({ ok: true });
    const metadata = resolveTo('93.184.215.14', '169.254.169.254');
    expect(
      await checkWebhookUrl('https://example.test/', { allowPrivate: true, resolve: metadata }),
    ).toMatchObject({ ok: false });
  });

  it('judges IP literals, also mapped IPv6, without DNS', async () => {
    const resolve: Resolver = () => Promise.reject(new Error('no DNS for literals'));
    for (const url of [
      'https://169.254.169.254/latest/meta-data',
      'https://[::ffff:169.254.169.254]/',
      'https://[fe80::1]/',
      'https://0.0.0.0/',
    ]) {
      expect([url, (await checkWebhookUrl(url, { allowPrivate: true, resolve })).ok]).toEqual([
        url,
        false,
      ]);
    }
    expect((await checkWebhookUrl('https://127.0.0.1/', { allowPrivate: false, resolve })).ok).toBe(
      false,
    );
    expect((await checkWebhookUrl('http://127.0.0.1/', { allowPrivate: true, resolve })).ok).toBe(
      true,
    );
    expect(
      (await checkWebhookUrl('https://[::ffff:127.0.0.1]/', { allowPrivate: false, resolve })).ok,
    ).toBe(false);
  });

  it('fails cleanly when the host does not resolve', async () => {
    const resolve: Resolver = () => Promise.reject(new Error('ENOTFOUND'));
    expect(
      await checkWebhookUrl('https://nowhere.test/', { allowPrivate: false, resolve }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('could not be found') as unknown });
  });
});

describe('pinned transport', () => {
  let server: Server;
  let port: number;
  const seen: { host: string | undefined; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({ host: req.headers.host, body });
        if (req.url === '/redirect') {
          res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
        } else if (req.url === '/big') {
          res.writeHead(500).end('x'.repeat(10_000));
        } else if (req.url === '/slow') {
          setTimeout(() => res.writeHead(200).end(), 2_000);
        } else {
          res.writeHead(204).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const send = (path: string, timeoutMs = 5_000) =>
    pinnedTransport({
      // This host does not exist: only the pinned address can make the request arrive.
      url: new URL(`http://hook.invalid:${port}${path}`),
      address: { address: '127.0.0.1', family: 4 },
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
      timeoutMs,
    });

  it('connects to the checked address, not a fresh DNS answer', async () => {
    expect(await send('/ok')).toEqual({ status: 204, body: '' });
    expect(seen.at(-1)).toEqual({ host: `hook.invalid:${port}`, body: '{"a":1}' });
  });

  it('does not follow redirects and keeps at most 2 KB of the answer', async () => {
    expect((await send('/redirect')).status).toBe(302);
    const big = await send('/big');
    expect(big.status).toBe(500);
    expect(big.body.length).toBe(2048);
  });

  it('gives up after the timeout', async () => {
    await expect(send('/slow', 200)).rejects.toThrow(/Timed out/);
  });
});
