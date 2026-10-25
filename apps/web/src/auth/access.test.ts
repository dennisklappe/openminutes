import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessConfigFromEnv, AccessVerifier } from './access.js';
import {
  AUDIENCE,
  makeKey,
  signToken,
  startFakeJwks,
  type FakeJwks,
  type TestKey,
} from './access-fixtures.js';

describe('AccessVerifier', () => {
  const key = makeKey('key-1');
  let jwks: FakeJwks;
  let clock = Date.now();
  let verifier: AccessVerifier;

  beforeAll(async () => {
    jwks = await startFakeJwks([key]);
    verifier = new AccessVerifier({ ...jwks.config, now: () => clock });
  });
  afterAll(() => jwks.close());

  it('accepts a valid token and lowercases the email', async () => {
    expect(await verifier.verify(signToken(key, {}, clock))).toBe('dana@example.com');
  });

  it('rejects a missing or malformed token', async () => {
    expect(await verifier.verify(undefined)).toBeUndefined();
    expect(await verifier.verify('a.b')).toBeUndefined();
    expect(await verifier.verify('a.b.c')).toBeUndefined();
  });

  it('rejects the wrong audience, issuer and expired tokens', async () => {
    expect(await verifier.verify(signToken(key, { aud: ['other'] }, clock))).toBeUndefined();
    expect(await verifier.verify(signToken(key, { iss: 'https://evil.example' }, clock))).toBe(
      undefined,
    );
    expect(
      await verifier.verify(signToken(key, { exp: Math.floor(clock / 1000) - 1 }, clock)),
    ).toBeUndefined();
    expect(
      await verifier.verify(signToken(key, { nbf: Math.floor(clock / 1000) + 600 }, clock)),
    ).toBeUndefined();
  });

  it('rejects tokens without an email, such as service tokens', async () => {
    expect(await verifier.verify(signToken(key, { email: undefined }, clock))).toBeUndefined();
  });

  it('accepts a string audience', async () => {
    expect(await verifier.verify(signToken(key, { aud: AUDIENCE }, clock))).toBe(
      'dana@example.com',
    );
  });

  it('rejects a bad signature and a payload swapped after signing', async () => {
    const [header, , signature] = signToken(key, {}, clock).split('.') as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({
        iss: `https://${jwks.config.teamDomain}`,
        aud: [AUDIENCE],
        exp: 9e9,
        email: 'x@y.z',
      }),
    ).toString('base64url');
    expect(await verifier.verify(`${header}.${forged}.${signature}`)).toBeUndefined();
    const stranger = makeKey('key-1');
    expect(await verifier.verify(signToken(stranger, {}, clock))).toBeUndefined();
  });

  it('refreshes the keys for an unknown kid, but not more than once a minute', async () => {
    const rotated: TestKey = makeKey('key-2');
    jwks.keys = [key, rotated];
    clock += 61_000;
    const before = jwks.requests();
    expect(await verifier.verify(signToken(rotated, {}, clock))).toBe('dana@example.com');
    expect(jwks.requests()).toBe(before + 1);

    const unknown = makeKey('key-3');
    expect(await verifier.verify(signToken(unknown, {}, clock))).toBeUndefined();
    expect(jwks.requests()).toBe(before + 1);

    clock += 61_000;
    expect(await verifier.verify(signToken(unknown, {}, clock))).toBeUndefined();
    expect(jwks.requests()).toBe(before + 2);
  });

  it('restricts to an email allow-list', async () => {
    const restricted = new AccessVerifier({
      ...jwks.config,
      emails: ['someone@example.com'],
      now: () => clock,
    });
    expect(await restricted.verify(signToken(key, {}, clock))).toBeUndefined();
    const allowed = new AccessVerifier({
      ...jwks.config,
      emails: ['dana@example.com'],
      now: () => clock,
    });
    expect(await allowed.verify(signToken(key, {}, clock))).toBe('dana@example.com');
  });

  it('fails closed when the keys cannot be fetched', async () => {
    const down = new AccessVerifier({ ...jwks.config, certsUrl: 'http://127.0.0.1:1/certs' });
    expect(await down.verify(signToken(key))).toBeUndefined();
  });
});

describe('accessConfigFromEnv', () => {
  const base = { OPENMINUTES_AUTH: 'cloudflare-access' as const };

  it('stays off in password mode', () => {
    expect(accessConfigFromEnv({ OPENMINUTES_AUTH: 'password' })).toBeUndefined();
  });

  it('refuses to start without a team domain or audience', () => {
    expect(() => accessConfigFromEnv(base)).toThrow(/TEAM_DOMAIN/);
    expect(() =>
      accessConfigFromEnv({ ...base, OPENMINUTES_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' }),
    ).toThrow(/ACCESS_AUD/);
  });

  it('parses the email allow-list', () => {
    expect(
      accessConfigFromEnv({
        ...base,
        OPENMINUTES_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
        OPENMINUTES_ACCESS_AUD: 'aud',
        OPENMINUTES_ACCESS_EMAILS: ' A@x.com, b@x.com ,',
      }),
    ).toEqual({
      teamDomain: 'team.cloudflareaccess.com',
      audience: 'aud',
      emails: ['a@x.com', 'b@x.com'],
    });
  });
});
