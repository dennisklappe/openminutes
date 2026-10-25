import type { Minutes } from '@openminutes/minutes';
import type { ShareRecipientDto } from '../dto.js';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** People of a meeting with a known email address, attendees first. */
export function recipientCandidates(
  minutes: Minutes,
  sent: ReadonlyMap<string, Date>,
): ShareRecipientDto[] {
  const seen = new Set<string>();
  const result: ShareRecipientDto[] = [];
  const add = (
    person: { name: string; email: string | null },
    attended: boolean,
    declined: boolean,
  ) => {
    if (!person.email) return;
    const key = normalizeEmail(person.email);
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      email: person.email,
      name: person.name,
      attended,
      declined,
      sentAt: sent.get(key)?.toISOString() ?? null,
    });
  };
  for (const person of minutes.attendees) add(person, true, false);
  for (const person of minutes.absent) add(person, false, person.declined);
  return result;
}

export function chooseRecipients(
  picked: readonly string[],
  extra: readonly string[],
  sent: ReadonlyMap<string, Date>,
  force: boolean,
): { willSend: string[]; alreadySent: string[] } {
  const unique = new Map<string, string>();
  for (const email of [...picked, ...extra]) {
    const key = normalizeEmail(email);
    if (!unique.has(key)) unique.set(key, email.trim());
  }
  const willSend: string[] = [];
  const alreadySent: string[] = [];
  for (const [key, email] of unique) {
    if (!force && sent.has(key)) alreadySent.push(email);
    else willSend.push(email);
  }
  return { willSend, alreadySent };
}
