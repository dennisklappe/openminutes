import {
  canonicalCompany,
  cleanCompany,
  companyKey,
  detectCompanyFromCalendar,
  domainOf,
  type SettingsStore,
} from '@openminutes/core';
import {
  asc,
  calendarAccounts,
  eq,
  isNull,
  meetings,
  transcriptSegments,
  and,
  type CompanySource,
  type Database,
} from '@openminutes/db';
import type { SummaryProvider } from '@openminutes/providers';

const CONFIDENCES = ['high', 'medium'];
const OWNER_SETTINGS = ['export.owner_email', 'email.owner_address', 'email.from_address'] as const;
const PROMPT_OVERHEAD_CHARS = 1500;

export const COMPANY_INSTRUCTIONS = `You are given the summary of a meeting. Name the external organisation the meeting was with or about, such as the customer, supplier, partner or employer of the other participants. Use the name as it is written in the text. Never guess: answer null when the meeting was internal, when several organisations are involved, or when no organisation is named.

Reply with JSON only, in exactly this shape: {"company":"Acme","confidence":"high"} where confidence is "high", "medium" or "low". Use {"company":null,"confidence":"low"} when there is no answer.`;

class CompanyReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompanyReplyError';
  }
}

/**
 * Reads the model answer and accepts a company only when it is a clean name, the model is not
 * unsure and the name occurs literally in the text it was given. Anything else is "unknown".
 */
export function parseCompanyReply(reply: string, evidence: string): string | undefined {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end < start) throw new CompanyReplyError('The model did not return JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new CompanyReplyError('The model returned invalid JSON');
  }
  const { company, confidence } = (parsed ?? {}) as Record<string, unknown>;
  const name = cleanCompany(company);
  if (!name || typeof confidence !== 'string' || !CONFIDENCES.includes(confidence)) {
    return undefined;
  }
  return evidence.toLowerCase().includes(name.toLowerCase()) ? name : undefined;
}

async function ownDomains(db: Database, settings: SettingsStore): Promise<Set<string>> {
  const accounts = await db.select({ email: calendarAccounts.accountEmail }).from(calendarAccounts);
  const configured = await Promise.all(OWNER_SETTINGS.map((key) => settings.get(key)));
  return new Set(
    [...accounts.map((a) => a.email), ...configured]
      .map((email) => domainOf(email ?? ''))
      .filter((domain): domain is string => domain !== undefined),
  );
}

async function knownCompanies(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ company: meetings.company })
    .from(meetings)
    .orderBy(asc(meetings.company));
  return rows.flatMap((row) => (row.company ? [row.company] : []));
}

async function store(
  db: Database,
  meetingId: string,
  company: string,
  source: CompanySource,
): Promise<void> {
  const known = await knownCompanies(db);
  await db
    .update(meetings)
    .set({ company: canonicalCompany(company, known, companyKey), companySource: source })
    .where(and(eq(meetings.id, meetingId), isNull(meetings.company)));
}

/**
 * Fills in the company of a finished meeting: first from the calendar (outside email domains of
 * the invitees, then the title), then by asking the summary model. A company that is already set,
 * by hand or earlier, is never replaced, the update repeats that check in SQL so an edit made
 * while the model was answering wins. Failures leave the company unknown.
 */
export async function detectCompany(
  deps: { db: Database; settings: SettingsStore },
  provider: SummaryProvider,
  meetingId: string,
  summary: string,
): Promise<void> {
  try {
    const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, meetingId));
    if (!meeting || meeting.company) return;

    const fromCalendar = detectCompanyFromCalendar(
      meeting,
      await ownDomains(deps.db, deps.settings),
    );
    if (fromCalendar) {
      await store(deps.db, meetingId, fromCalendar, 'calendar');
      return;
    }

    const segments = await deps.db
      .select({ text: transcriptSegments.text })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId))
      .orderBy(asc(transcriptSegments.startMs));
    const evidence = [meeting.title, summary, ...segments.map((s) => s.text)].join('\n');
    const input = `Title: ${meeting.title}\n\n${summary}`.slice(
      0,
      Math.max(2000, provider.maxInputChars - PROMPT_OVERHEAD_CHARS),
    );
    const company = parseCompanyReply(
      await provider.summarize(input, COMPANY_INSTRUCTIONS),
      evidence,
    );
    if (company) await store(deps.db, meetingId, company, 'ai');
  } catch (error) {
    console.error(
      `company of meeting ${meetingId} could not be detected, leaving it unknown`,
      error,
    );
  }
}
