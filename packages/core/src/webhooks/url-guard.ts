import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Keeps webhooks away from the machine and network OpenMinutes runs in (SSRF). A URL is checked
 * when it is saved and again before every attempt, on every address the host resolves to. The
 * dispatcher then connects to the checked address itself, so a second DNS answer cannot swap in
 * another one (rebinding).
 *
 * - blocked always: unspecified, link-local (cloud metadata at 169.254.169.254 and fe80::/10),
 *   multicast, reserved and broadcast, the known metadata addresses inside private ranges
 * - private, only with the endpoint's allowPrivate: loopback, RFC 1918, CGNAT, ULA and other
 *   ranges that are not on the internet
 * - IPv4 inside IPv6 (mapped, NAT64, 6to4) is judged by the IPv4 address it carries
 */
export type AddressClass = 'public' | 'private' | 'blocked';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = async (hostname) => {
  const found = await lookup(hostname, { all: true, order: 'verbatim' });
  return found.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
};

type Range = readonly [base: bigint, bits: number, size: 32 | 128];

function ipv4ToBigInt(address: string): bigint {
  return address.split('.').reduce((total, part) => (total << 8n) | BigInt(Number(part) & 255), 0n);
}

function ipv6ToBigInt(address: string): bigint {
  let text = address.toLowerCase().split('%')[0] ?? '';
  // A dotted IPv4 tail (::ffff:1.2.3.4) becomes two hex groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted?.[1]) {
    const v4 = ipv4ToBigInt(dotted[1]);
    text = `${text.slice(0, -dotted[1].length)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return groups.reduce((total, group) => (total << 16n) | BigInt(parseInt(group || '0', 16)), 0n);
}

const v4 = (cidr: string): Range => {
  const [base = '', bits = '32'] = cidr.split('/');
  return [ipv4ToBigInt(base), Number(bits), 32];
};
const v6 = (cidr: string): Range => {
  const [base = '', bits = '128'] = cidr.split('/');
  return [ipv6ToBigInt(base), Number(bits), 128];
};

const inRange = (value: bigint, [base, bits, size]: Range): boolean => {
  const shift = BigInt(size - bits);
  return value >> shift === base >> shift;
};

const BLOCKED_V4 = [
  '0.0.0.0/8',
  '169.254.0.0/16',
  '224.0.0.0/4',
  '240.0.0.0/4',
  // Alibaba Cloud metadata, inside CGNAT.
  '100.100.100.200/32',
].map(v4);
const PRIVATE_V4 = [
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
].map(v4);
const BLOCKED_V6 = [
  '::/128',
  'fe80::/10',
  'ff00::/8',
  // AWS metadata over IPv6, inside the ULA range.
  'fd00:ec2::254/128',
  // IPv4-compatible addresses, deprecated and never needed.
  '::/96',
].map(v6);
const LOOPBACK_V6 = 1n;
const PRIVATE_V6 = ['fc00::/7', '2001:db8::/32', '100::/64'].map(v6);
const MAPPED = v6('::ffff:0:0/96');
const NAT64 = v6('64:ff9b::/96');
const SIX_TO_FOUR = v6('2002::/16');

function classifyV4(value: bigint): AddressClass {
  if (BLOCKED_V4.some((range) => inRange(value, range))) return 'blocked';
  if (PRIVATE_V4.some((range) => inRange(value, range))) return 'private';
  return 'public';
}

/** Says whether an IP address is on the internet, on a private network, or never allowed. */
export function classifyAddress(address: string): AddressClass {
  const family = isIP(address.split('%')[0] ?? '');
  if (family === 4) return classifyV4(ipv4ToBigInt(address));
  if (family !== 6) return 'blocked';
  const value = ipv6ToBigInt(address);
  if (inRange(value, MAPPED) || inRange(value, NAT64)) return classifyV4(value & 0xffffffffn);
  if (inRange(value, SIX_TO_FOUR)) return classifyV4((value >> 80n) & 0xffffffffn);
  if (value === LOOPBACK_V6) return 'private';
  if (BLOCKED_V6.some((range) => inRange(value, range))) return 'blocked';
  if (PRIVATE_V6.some((range) => inRange(value, range))) return 'private';
  return 'public';
}

export type UrlCheck =
  { ok: true; url: URL; addresses: ResolvedAddress[] } | { ok: false; error: string };

export interface UrlCheckOptions {
  allowPrivate: boolean;
  resolve?: Resolver;
}

const MAX_URL_LENGTH = 2048;

/** The checks that need no DNS: scheme, credentials and the shape of the URL. */
export function parseWebhookUrl(
  raw: string,
  allowPrivate: boolean,
): { ok: true; url: URL } | { ok: false; error: string } {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: 'The URL is too long' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'The URL is not valid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'The URL must start with https://' };
  }
  if (url.protocol === 'http:' && !allowPrivate) {
    return { ok: false, error: 'The URL must use https, or allow private networks for http' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Put no user name or password in the URL, use the signature' };
  }
  if (!url.hostname) return { ok: false, error: 'The URL has no host' };
  return { ok: true, url };
}

const bareHost = (hostname: string) =>
  hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

/** Checks a URL and every address its host resolves to. Never throws. */
export async function checkWebhookUrl(raw: string, options: UrlCheckOptions): Promise<UrlCheck> {
  const parsed = parseWebhookUrl(raw, options.allowPrivate);
  if (!parsed.ok) return parsed;
  const host = bareHost(parsed.url.hostname);
  let addresses: ResolvedAddress[];
  const literal = isIP(host);
  if (literal) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await (options.resolve ?? systemResolver)(host);
    } catch {
      return { ok: false, error: `The host ${host} could not be found` };
    }
    if (addresses.length === 0) return { ok: false, error: `The host ${host} could not be found` };
  }
  for (const { address } of addresses) {
    const kind = classifyAddress(address);
    if (kind === 'blocked') {
      return { ok: false, error: `The address ${address} is never allowed for webhooks` };
    }
    if (kind === 'private' && !options.allowPrivate) {
      return {
        ok: false,
        error: `The host resolves to the private address ${address}, allow private networks to use it`,
      };
    }
  }
  return { ok: true, url: parsed.url, addresses };
}
