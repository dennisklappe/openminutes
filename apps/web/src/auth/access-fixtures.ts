import { createServer, type Server } from 'node:http';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { AccessConfig } from './access.js';

const TEAM_DOMAIN = 'team.cloudflareaccess.com';
export const AUDIENCE = 'aud-tag-123';

export interface TestKey {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

export function makeKey(kid: string): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256' } };
}

export function signToken(
  key: TestKey,
  claims: Record<string, unknown> = {},
  now = Date.now(),
): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'RS256', kid: key.kid })}.${encode({
    iss: `https://${TEAM_DOMAIN}`,
    aud: [AUDIENCE],
    email: 'Dana@Example.com',
    exp: Math.floor(now / 1000) + 3600,
    ...claims,
  })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key.privateKey).toString('base64url')}`;
}

export interface FakeJwks {
  config: AccessConfig;
  keys: TestKey[];
  requests: () => number;
  close: () => Promise<void>;
}

export async function startFakeJwks(keys: TestKey[]): Promise<FakeJwks> {
  const state = { keys, requests: 0 };
  const server: Server = createServer((_request, response) => {
    state.requests += 1;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys: state.keys.map((key) => key.jwk) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    config: {
      teamDomain: TEAM_DOMAIN,
      audience: AUDIENCE,
      certsUrl: `http://127.0.0.1:${port}/certs`,
    },
    get keys() {
      return state.keys;
    },
    set keys(next: TestKey[]) {
      state.keys = next;
    },
    requests: () => state.requests,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}
