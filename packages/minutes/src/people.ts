import type { MinutesPerson } from './types.js';

export const normalise = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const localPart = (email: string) => email.slice(0, email.indexOf('@'));

/** Names only: an email address never goes into minutes that leave the app. */
export function personLabel(person: MinutesPerson): string {
  return person.joinedAs ? `${person.name} (${person.joinedAs})` : person.name;
}

export function sameEmail(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

export function displayNameOf(person: { name: string | null; email: string }): string {
  return person.name ?? normaliseLocal(person.email);
}

function normaliseLocal(email: string): string {
  const words = normalise(localPart(email)).split(' ');
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function dedupePeople<T extends MinutesPerson>(people: readonly T[]): T[] {
  const seen = new Set<string>();
  return people.filter((person) => {
    const key = person.email?.toLowerCase() ?? normalise(person.name);
    if (key === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const sameParticipant = (a: string, b: string) => normalise(a) === normalise(b);
