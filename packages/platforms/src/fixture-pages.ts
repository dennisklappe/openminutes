import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../fixtures/${path}`, import.meta.url));

const teamsHosts = new Set(['teams.microsoft.com', 'teams.live.com']);
const teamsPages = [
  'launcher',
  'prejoin',
  'lobby',
  'meeting',
  'blocked',
  'denied',
  'ended',
  'left',
];

export function fixturePage(url: URL): Buffer | undefined {
  if (url.hostname === 'meet.google.com') return read('meet/index.html');
  if (!teamsHosts.has(url.hostname)) return undefined;
  const page = /^\/fixture\/(\w+)$/.exec(url.pathname)?.[1];
  if (page === undefined) return read('teams/launcher.html');
  return teamsPages.includes(page) ? read(`teams/${page}.html`) : undefined;
}
