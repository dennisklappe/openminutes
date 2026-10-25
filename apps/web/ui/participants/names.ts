import type { InviteeDto, ParticipantDto } from '../../src/dto.js';

export const NAME_MAX = 80;

export interface RenameChange {
  name: string;
  inviteeEmail: string | null;
}

/** What to save, or undefined when the name is invalid or nothing changed. `link` is '' for none. */
export function renameToSave(
  draft: string,
  person: ParticipantDto,
  link: string,
): RenameChange | undefined {
  const name = draft.trim();
  if (name === '' || name.length > NAME_MAX) return undefined;
  if (name === person.name && link === (person.inviteeEmail ?? '')) return undefined;
  return { name, inviteeEmail: link === '' ? null : link };
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

export const inviteeLabel = (invitee: InviteeDto) =>
  invitee.name ? `${invitee.name} (${invitee.email})` : invitee.email;

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
