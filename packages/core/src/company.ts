export const COMPANY_MAX = 80;

const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.nl',
  'hotmail.com',
  'hotmail.nl',
  'live.com',
  'live.nl',
  'msn.com',
  'yahoo.com',
  'yahoo.co.uk',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.de',
  'web.de',
  't-online.de',
  'ziggo.nl',
  'kpnmail.nl',
  'planet.nl',
  'xs4all.nl',
  'telenet.be',
  'skynet.be',
  'btinternet.com',
  'sky.com',
  'fastmail.com',
  'hey.com',
  'zoho.com',
  'mail.com',
  'yandex.com',
  'qq.com',
  '163.com',
]);

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

const LEGAL_WORDS = new Set([
  'bv',
  'nv',
  'inc',
  'llc',
  'ltd',
  'limited',
  'plc',
  'gmbh',
  'ag',
  'sa',
  'sas',
  'sarl',
  'srl',
  'oy',
  'ab',
  'as',
  'kg',
  'ug',
  'vof',
  'corp',
  'corporation',
  'co',
  'company',
]);

const TITLE_SUBJECT = /^(.{2,40}?)\s+(?:meeting|call|sync|overleg|gesprek|kickoff|kick-off)$/i;
const TITLE_PREFIXED =
  /^(?:customer|client|support|sales|partner|vendor|supplier)?\s*(?:call|meeting|sync|demo|kickoff|kick-off|onboarding|intro|workshop|review|escalation|qbr)\s*[:-]\s*(.{2,40})$/i;
const GENERIC_SUBJECTS = new Set([
  'team',
  'weekly',
  'daily',
  'monthly',
  'project',
  'planning',
  'sprint',
  'standup',
  'stand-up',
  'board',
  'client',
  'customer',
  'sales',
  'marketing',
  'design',
  'product',
  'engineering',
  'staff',
  'status',
  'review',
  'budget',
  'strategy',
  'all hands',
  'one-on-one',
  'kickoff',
  'general',
  'quick',
  'intro',
  'follow-up',
  'follow up',
  'team meeting',
  'online',
  'video',
  'phone',
  'conference',
]);

export interface Invitee {
  email: string;
  name?: string | null;
}

export const domainOf = (email: string): string | undefined => {
  const at = email.lastIndexOf('@');
  const domain =
    at < 0
      ? ''
      : email
          .slice(at + 1)
          .trim()
          .toLowerCase();
  return domain.includes('.') ? domain : undefined;
};

export function cleanCompany(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name === '' || name.length > COMPANY_MAX || /\p{Cc}/u.test(name)) return undefined;
  return name;
}

export const exactKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

export function companyKey(name: string): string {
  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ.,]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_WORDS.has(words.at(-1) ?? '')) words.pop();
  return words.join(' ');
}

export function canonicalCompany(
  name: string,
  known: readonly string[],
  keyOf: (name: string) => string = exactKey,
): string {
  const key = keyOf(name);
  return known.find((candidate) => keyOf(candidate) === key) ?? name;
}

export function companyFromDomain(domain: string): string | undefined {
  const labels = domain.toLowerCase().split('.');
  const second = labels.at(-2);
  const base =
    labels.length >= 3 && second && SECOND_LEVEL.has(second) && (labels.at(-1)?.length ?? 0) === 2
      ? labels.at(-3)
      : second;
  if (!base || !/^[a-z0-9-]+$/.test(base)) return undefined;
  const words = base.split('-').filter(Boolean);
  if (words.length === 0) return undefined;
  if (words.length === 1 && (words[0]?.length ?? 0) <= 3 && /^[a-z]+$/.test(words[0] ?? '')) {
    return words[0]?.toUpperCase();
  }
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

const isFreeOrResource = (domain: string) =>
  FREE_MAIL.has(domain) || domain.endsWith('calendar.google.com');

export function companyFromInvitees(
  invitees: readonly Invitee[],
  ownDomains: ReadonlySet<string>,
): string | undefined {
  const counts = new Map<string, number>();
  for (const { email } of invitees) {
    const domain = domainOf(email);
    if (!domain || ownDomains.has(domain) || isFreeOrResource(domain)) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const [top, runnerUp] = ranked;
  if (!top || top[1] === runnerUp?.[1]) return undefined;
  return companyFromDomain(top[0]);
}

export function companyFromTitle(
  title: string,
  ownDomains: ReadonlySet<string>,
): string | undefined {
  const match = TITLE_PREFIXED.exec(title.trim()) ?? TITLE_SUBJECT.exec(title.trim());
  const subject = cleanCompany(match?.[1]);
  if (!subject) return undefined;
  const words = subject.split(' ');
  const capitalised = words.every((word) => /^[\p{Lu}\d]/u.test(word));
  if (words.length > 3 || !capitalised || GENERIC_SUBJECTS.has(subject.toLowerCase())) {
    return undefined;
  }
  const own = [...ownDomains].map((domain) => companyFromDomain(domain)).filter(Boolean);
  return own.some((name) => name && companyKey(name) === companyKey(subject)) ? undefined : subject;
}

export function detectCompanyFromCalendar(
  meeting: { title: string; invitees: readonly Invitee[] | null },
  ownDomains: ReadonlySet<string>,
): string | undefined {
  return (
    companyFromInvitees(meeting.invitees ?? [], ownDomains) ??
    companyFromTitle(meeting.title, ownDomains)
  );
}
