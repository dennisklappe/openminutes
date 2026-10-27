export interface DuplicateCandidate {
  id: string;
  name: string;
  emails: readonly string[];
}

/** Shared mail providers: the same domain says nothing about the same person. */
const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.de',
  'web.de',
  'ziggo.nl',
  'kpnmail.nl',
  'planet.nl',
  'hetnet.nl',
]);

const MAX_PER_PERSON = 3;

const tokens = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '');

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1);

const ownDomains = (emails: readonly string[]) =>
  new Set(emails.map(domainOf).filter((domain) => domain !== '' && !FREE_MAIL.has(domain)));

/** One name is the start of the other, such as "Dennis" and "Dennis Klappe". */
function prefixOf(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length > 0 && short.length < long.length && short.every((t, i) => t === long[i]);
}

/**
 * Pairs that are probably one person: the same email, or one name is the start of the other and
 * both have an email on the same company domain. Only a hint, people are never merged on it.
 */
export function findDuplicates(rows: readonly DuplicateCandidate[]): Map<string, string[]> {
  const found = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const set = found.get(from) ?? new Set<string>();
      set.add(to);
      found.set(from, set);
    }
  };
  const byEmail = new Map<string, string>();
  for (const row of rows) {
    for (const email of row.emails) {
      const owner = byEmail.get(email);
      if (owner && owner !== row.id) link(owner, row.id);
      else byEmail.set(email, row.id);
    }
  }
  const byFirst = new Map<string, (DuplicateCandidate & { parts: string[] })[]>();
  for (const row of rows) {
    const parts = tokens(row.name);
    const first = parts[0];
    if (first === undefined) continue;
    byFirst.set(first, [...(byFirst.get(first) ?? []), { ...row, parts }]);
  }
  for (const group of byFirst.values()) {
    for (const [i, a] of group.entries()) {
      for (const b of group.slice(i + 1)) {
        if (!prefixOf(a.parts, b.parts)) continue;
        const domains = ownDomains(a.emails);
        if ([...ownDomains(b.emails)].some((domain) => domains.has(domain))) link(a.id, b.id);
      }
    }
  }
  return new Map(
    [...found].map(([id, others]) => [id, [...others].slice(0, MAX_PER_PERSON)] as const),
  );
}
