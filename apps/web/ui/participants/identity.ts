import type { IdentityInviteeDto, SpeakerIdentityDto } from '../../src/dto.js';
import { NAME_MAX, validEmail } from './names.js';

export interface IdentityDraft {
  name: string;
  emails: string[];
}

const lower = (email: string) => email.trim().toLowerCase();

/** The draft to save, or undefined when the name is invalid or nothing changed. */
export function identityToSave(
  name: string,
  emails: readonly string[],
  identity: Pick<SpeakerIdentityDto, 'name' | 'emails'>,
): IdentityDraft | undefined {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > NAME_MAX) return undefined;
  const wanted = emails.map(lower);
  const same =
    trimmed === identity.name &&
    wanted.length === identity.emails.length &&
    wanted.every((email) => identity.emails.includes(email));
  return same ? undefined : { name: trimmed, emails: wanted };
}

/** Adds a typed address to the list, or says why it cannot be. */
export function addTypedEmail(
  emails: readonly string[],
  typed: string,
): { emails: string[]; error?: string } {
  const email = lower(typed);
  if (email === '') return { emails: [...emails] };
  if (!validEmail(email)) return { emails: [...emails], error: 'That is not an email address' };
  if (emails.includes(email))
    return { emails: [...emails], error: 'That address is there already' };
  return { emails: [...emails, email] };
}

export const withoutEmail = (emails: readonly string[], email: string): string[] =>
  emails.filter((own) => own !== lower(email));

/** The invitees of the meeting not bound yet: free ones first, taken by someone else last. */
export function inviteeSuggestions(
  invitees: readonly IdentityInviteeDto[],
  emails: readonly string[],
): IdentityInviteeDto[] {
  const rest = invitees.filter((invitee) => !emails.includes(lower(invitee.email)));
  return [...rest.filter((i) => !i.takenBy), ...rest.filter((i) => i.takenBy)];
}

/** What saving does when the name is someone else already, in the words of the dialog. */
export function matchNote(match: SpeakerIdentityDto['match']): string | undefined {
  return match
    ? `${match.name} exists already. Saving joins this speaker with them and keeps their addresses.`
    : undefined;
}

export const peopleHref = (personId: string | null): string | undefined =>
  personId ? `#/people/${personId}` : undefined;
