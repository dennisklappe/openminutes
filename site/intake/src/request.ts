const TIERS = ['solo', 'team', 'company', 'custom'] as const;
export type TierId = (typeof TIERS)[number];

export interface HostingRequest {
  name: string;
  email: string;
  tier: TierId;
  notes: string;
}

export type Parsed =
  | { kind: 'ok'; request: HostingRequest }
  | { kind: 'bot' }
  | { kind: 'invalid'; error: 'invalid_email' | 'invalid_tier' };

/** No whitespace, control characters, quotes, brackets, commas or other address syntax. */
const EMAIL =
  /^[^\s@<>(),;:"\\[\]\p{Cc}]+@[^\s@.<>(),;:"\\[\]\p{Cc}]+\.[^\s@<>(),;:"\\[\]\p{Cc}]+$/u;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** A single line: the name ends up in a ticket subject. */
const line = (value: unknown, max: number): string =>
  text(value, max * 2)
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function parseRequest(payload: Record<string, unknown>): Parsed {
  if (text(payload.website, 200)) return { kind: 'bot' };
  const email = text(payload.email, 200).toLowerCase();
  if (!EMAIL.test(email)) return { kind: 'invalid', error: 'invalid_email' };
  const tier = text(payload.tier, 20);
  if (!TIERS.some((t) => t === tier)) return { kind: 'invalid', error: 'invalid_tier' };
  return {
    kind: 'ok',
    request: {
      name: line(payload.name, 120),
      email,
      tier: tier as TierId,
      notes: text(payload.notes, 4000),
    },
  };
}

export function ticketSubject(request: HostingRequest): string {
  return `Hosting request from ${request.name || request.email}`;
}

export function ticketMessage(request: HostingRequest): string {
  return [`Tier: ${request.tier}`, '', request.notes || '(no further detail)'].join('\n');
}
