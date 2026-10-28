import type { InviteeDto, ParticipantDto } from '../../src/dto.js';

export const NAME_MAX = 80;

export interface RenameChange {
  name: string;
  inviteeEmails: string[];
  /** Only set when the person is not on the invitation, null clears it. */
  email?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validEmail = (value: string) => value === '' || EMAIL.test(value);

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((email) => b.includes(email));

/**
 * What to save, or undefined when the name or the typed email is invalid or nothing changed.
 * `links` are the invitees this person is. `email` is only used when there are none.
 */
export function renameToSave(
  draft: string,
  person: ParticipantDto,
  links: readonly string[],
  email = '',
): RenameChange | undefined {
  const name = draft.trim();
  const typed = email.trim();
  if (name === '' || name.length > NAME_MAX || !validEmail(typed)) return undefined;
  const ownEmail = links.length === 0;
  if (
    name === person.name &&
    sameSet(links, person.inviteeEmails) &&
    (!ownEmail || typed === (person.email ?? ''))
  ) {
    return undefined;
  }
  return {
    name,
    inviteeEmails: [...links],
    ...(ownEmail && { email: typed === '' ? null : typed }),
  };
}

const firstWord = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .find(Boolean) ?? '';

const inviteeFirstWord = (invitee: InviteeDto) =>
  firstWord(invitee.name ?? invitee.email.slice(0, invitee.email.indexOf('@')));

/** "bart.de-vries@example.com" becomes "Bart De Vries". */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const words = local
    .replace(/\+.*$/, '')
    .split(/[._\-\s]+/)
    .filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || email;
}

export const inviteeLabel = (invitee: InviteeDto) => {
  const email = invitee.email.toLowerCase();
  return invitee.name ? `${invitee.name} (${email})` : email;
};

/** The email of the only invitee sharing a first name with one of these names, or '' when unclear. */
export function likelyInvitee(
  names: readonly (string | null)[],
  candidates: readonly InviteeDto[],
) {
  const wanted = names.flatMap((name) => (name ? [firstWord(name)] : []));
  const matching = candidates.filter((invitee) => wanted.includes(inviteeFirstWord(invitee)));
  return matching.length === 1 && matching[0] ? matching[0].email : '';
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { timeStyle: 'short' });

export function presence(person: Pick<ParticipantDto, 'joinedAt' | 'leftAt'>): string | undefined {
  if (person.joinedAt && person.leftAt)
    return `${clock(person.joinedAt)} to ${clock(person.leftAt)}`;
  if (person.joinedAt) return `Joined ${clock(person.joinedAt)}`;
  if (person.leftAt) return `Left ${clock(person.leftAt)}`;
  return undefined;
}
