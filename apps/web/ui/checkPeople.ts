import type {
  CheckMatchDto,
  CheckOptionDto,
  CheckPeopleConfirmInput,
  CheckVoiceDto,
} from '../src/dto.js';
import { NAME_MAX } from './voices.js';

/** What the owner wants for a voice: the match shown, someone from the pickers, a new name, or nothing yet. */
export type Choice =
  | { kind: 'match' }
  | { kind: 'person'; personId: string | null; name: string; email?: string | null }
  | { kind: 'new'; name: string; email?: string }
  | { kind: 'none' };

const plural = (count: number) => `${String(count)} ${count === 1 ? 'person' : 'people'}`;

export function headline(voices: readonly CheckVoiceDto[]): string {
  const who = voices.map((voice) =>
    voice.match
      ? `${voice.match.name} (${voice.match.certainty})`
      : `${voice.label} (no match yet)`,
  );
  return `${plural(voices.length)} detected: ${who.join(', ')}. Is that right?`;
}

const sources: Record<CheckMatchDto['source'], string> = {
  voice: 'Matches',
  calendar: 'Invited:',
  label: 'Already called',
};

export const matchText = (match: CheckMatchDto) =>
  `${sources[match.source]} ${match.name} (${match.certainty})`;

/** Only ever a guess, it is not saved anywhere. */
export const companyText = (match: CheckMatchDto) =>
  match.company ? `Company: probably ${match.company.name}` : undefined;

/** Picking someone from the list or an invitee chip gives that person to the voice. */
export const optionChoice = (option: CheckOptionDto): Choice => ({
  kind: 'person',
  personId: option.personId,
  name: option.name,
  email: option.email,
});

export const initialChoices = (voices: readonly CheckVoiceDto[]): Record<string, Choice> =>
  Object.fromEntries(
    voices.map((voice): [string, Choice] => [
      voice.id,
      voice.match ? { kind: 'match' } : { kind: 'none' },
    ]),
  );

function nameOf(voice: CheckVoiceDto, choice: Choice | undefined): string | undefined {
  if (choice?.kind === 'match') return voice.match?.name;
  if (choice?.kind === 'person' || choice?.kind === 'new') return choice.name.trim();
  return undefined;
}

export function confirmInput(
  voices: readonly CheckVoiceDto[],
  choices: Record<string, Choice>,
): CheckPeopleConfirmInput {
  const sent: CheckPeopleConfirmInput['voices'] = [];
  for (const voice of voices) {
    const choice = choices[voice.id];
    if (choice?.kind === 'match' && voice.match) {
      const { match } = voice;
      sent.push({
        participantId: voice.id,
        ...(match.personId
          ? { personId: match.personId }
          : { name: match.name, ...(match.email && { email: match.email }) }),
      });
    } else if (choice?.kind === 'person') {
      sent.push({
        participantId: voice.id,
        ...(choice.personId
          ? { personId: choice.personId }
          : { name: choice.name, ...(choice.email && { email: choice.email }) }),
      });
    } else if (choice?.kind === 'new' && choice.name.trim() !== '') {
      sent.push({
        participantId: voice.id,
        name: choice.name.trim(),
        ...(choice.email?.trim() && { email: choice.email.trim() }),
      });
    }
  }
  return { voices: sent };
}

export function canConfirm(
  voices: readonly CheckVoiceDto[],
  choices: Record<string, Choice>,
): boolean {
  const names = voices.flatMap((voice) => {
    const choice = choices[voice.id];
    if (!choice || choice.kind === 'none') return [];
    const name = nameOf(voice, choice);
    return [name ?? ''];
  });
  if (names.length === 0) return false;
  if (names.some((name) => name === '' || name.length > NAME_MAX)) return false;
  return new Set(names.map((name) => name.toLowerCase())).size === names.length;
}

export interface AttendeeChip {
  key: string;
  name: string;
  note: string;
  label: string;
  pressed: boolean;
}

/** The invited people of a meeting as chips; the one that is picked now is pressed. */
export function attendeeChips(
  attendees: readonly CheckOptionDto[],
  choice: Choice,
  picked: string | undefined,
): AttendeeChip[] {
  return attendees.map((attendee) => ({
    key: attendee.email ?? attendee.name,
    name: attendee.name,
    note: 'Invited',
    label: `${attendee.name}, invited`,
    pressed: choice.kind !== 'none' && picked === attendee.name,
  }));
}
