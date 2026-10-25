import type { MeetingPlatform } from '@openminutes/db';
import { teamsHosts, unwrapLink } from './unwrap-link.js';

export interface MeetingLink {
  platform: MeetingPlatform;
  code: string | undefined;
  canonicalUrl: string;
  key: string;
}

const MEET_HOST = 'meet.google.com';
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const MEET_LOOKUP_ID = /^[\w-]+$/;
const MEET_PREFIXES = new Set(['meet', '_meet']);

function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function parseMeet(url: URL): MeetingLink | undefined {
  const parts = pathSegments(url.pathname).map((part) => decodeURIComponent(part).toLowerCase());
  if (parts.length > 1 && MEET_PREFIXES.has(parts[0] ?? '')) parts.shift();
  const [first, second] = parts;
  if (parts.length === 1 && first && MEET_CODE.test(first)) {
    return {
      platform: 'meet',
      code: first,
      canonicalUrl: `https://${MEET_HOST}/${first}`,
      key: `meet:${first}`,
    };
  }
  if (parts.length === 2 && first === 'lookup' && second && MEET_LOOKUP_ID.test(second)) {
    return {
      platform: 'meet',
      code: second,
      canonicalUrl: `https://${MEET_HOST}/lookup/${second}`,
      key: `meet:lookup/${second}`,
    };
  }
  return undefined;
}

function launcherTarget(url: URL): string | undefined {
  if (!url.pathname.startsWith('/dl/launcher/')) return undefined;
  const target = url.searchParams.get('url');
  return target ? decodeURIComponent(target).replace(/^\/_#/, '#') : undefined;
}

function teamsLocation(url: URL): { path: string; search: string } {
  for (const hash of [url.hash, launcherTarget(url)]) {
    if (!hash?.startsWith('#/')) continue;
    const { pathname, search } = new URL(hash.slice(1), 'https://x');
    if (/^\/(?:meet|l\/meetup-join)\//.test(pathname)) return { path: pathname, search };
  }
  return { path: url.pathname, search: url.search };
}

function parseTeams(url: URL, host: string): MeetingLink | undefined {
  const { path, search } = teamsLocation(url);
  const parts = pathSegments(path);
  const [first, second, third] = parts;
  const base = `https://${host}`;
  if (first === 'l' && second === 'meetup-join' && third) {
    const thread = decodeURIComponent(third).toLowerCase();
    return {
      platform: 'teams',
      code: undefined,
      canonicalUrl: `${base}${path}${search}`,
      key: `teams:${thread}`,
    };
  }
  if (first === 'meet' && second && parts.length === 2) {
    return {
      platform: 'teams',
      code: second,
      canonicalUrl: `${base}/meet/${second}${search}`,
      key: `teams-meet:${host}/${second.toLowerCase()}`,
    };
  }
  return undefined;
}

export function parseMeetingLink(raw: string): MeetingLink | undefined {
  const url = unwrapLink(raw.trim());
  if (!url) return undefined;
  const host = url.hostname.replace(/^www\./, '');
  try {
    if (host === MEET_HOST) return parseMeet(url);
    if (teamsHosts.has(host)) return parseTeams(url, host);
  } catch {
    return undefined;
  }
  return undefined;
}

export function defaultMeetingTitle(label: string, link: MeetingLink): string {
  return link.code ? `${label} ${link.code}` : label;
}
