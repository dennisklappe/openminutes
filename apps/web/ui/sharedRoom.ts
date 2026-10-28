import type {
  InviteeDto,
  ParticipantDto,
  RoomGroupDto,
  RoomNoticeDto,
  SubPersonDto,
  SharedAccountDto,
} from '../src/dto.js';
import { formatLength } from './format.js';
import type { InvitedOption, PickerOption } from './review.js';
import { nameFromEmail } from './participants/names.js';

/** The counts offered by the "how many people?" question. 1 means "it is one person". */
export const QUESTION_COUNTS = [1, 2, 3] as const;

/** The splits offered on a tile: 2 and 3 people, only when nobody was named yet. */
export function splitOptions(room: Pick<RoomGroupDto, 'canSplit' | 'count'>): (2 | 3)[] {
  return room.canSplit && room.count !== null ? [2, 3] : [];
}

/** Whether the tile still waits for "how many people?" (the notice carries the question). */
export const questionOpen = (room: Pick<RoomGroupDto, 'count' | 'detected'>) =>
  room.count === null && room.detected > 0;

/** "Jo and Sam sounds like several people. How many?" */
export const questionText = (notice: Pick<RoomNoticeDto, 'name'>) =>
  `${notice.name} sounds like several people. How many?`;

const clock = (date: Date) => date.toLocaleTimeString(undefined, { timeStyle: 'short' });

/** Tells that the summary waits for the answer, or nothing when it does not (or no longer). */
export function waitText(waitsUntil: string | null, now: Date = new Date()): string | undefined {
  if (!waitsUntil) return undefined;
  const until = new Date(waitsUntil);
  if (Number.isNaN(until.getTime()) || until <= now) return undefined;
  return `The summary waits until ${clock(until)} for your answer. The rest goes on.`;
}

/** "3 min talking, 5 lines" */
export function subMeta(sub: Pick<SubPersonDto, 'talkMs' | 'lines'>): string {
  const lines = `${String(sub.lines)} ${sub.lines === 1 ? 'line' : 'lines'}`;
  return sub.talkMs > 0 ? `${formatLength(sub.talkMs)} talking, ${lines}` : lines;
}

/** Unnamed voices first, so the work that is left is at the top; else by voice number. */
export function orderSubs(subs: readonly SubPersonDto[]): SubPersonDto[] {
  return subs.toSorted((a, b) => a.number - b.number);
}

/** One line of the People list: a participant, or one voice of a shared tile as a person. */
export type PeopleRow =
  | { kind: 'person'; person: ParticipantDto }
  | { kind: 'voice'; tile: ParticipantDto; sub: SubPersonDto };

export interface PeopleList {
  rows: PeopleRow[];
  /** Shared tiles to note under the list: not a participant, the actions that belong to the tile. */
  notes: ParticipantDto[];
}

/** A tile whose people are listed instead of the tile. */
export const isFlatTile = (
  person: ParticipantDto,
): person is ParticipantDto & { room: RoomGroupDto } =>
  person.room !== undefined && !questionOpen(person.room) && person.room.subs.length > 0;

/**
 * The People list with every voice of a shared tile as a person of its own, in the place of the
 * tile and in voice order. A voice whose person also is a participant of their own goes right
 * under that participant, which stays its own row. The tile is no row: it is a note, unless it has
 * a single voice (nothing to decide then).
 */
export function flattenPeople(participants: readonly ParticipantDto[]): PeopleList {
  const rows: PeopleRow[] = [];
  const notes: ParticipantDto[] = [];
  const under = new Map<string, PeopleRow[]>();
  const present = new Set(participants.map((person) => person.id));
  for (const person of participants) {
    if (!isFlatTile(person)) continue;
    for (const sub of person.room.subs) {
      if (!sub.seatSeparate || !present.has(sub.participantId)) continue;
      under.set(sub.participantId, [
        ...(under.get(sub.participantId) ?? []),
        { kind: 'voice', tile: person, sub },
      ]);
    }
  }
  for (const person of participants) {
    if (isFlatTile(person)) {
      for (const sub of orderSubs(person.room.subs)) {
        if (!sub.seatSeparate || !present.has(sub.participantId)) {
          rows.push({ kind: 'voice', tile: person, sub });
        }
      }
    } else {
      rows.push({ kind: 'person', person }, ...(under.get(person.id) ?? []));
    }
    if (person.room && !questionOpen(person.room) && person.room.subs.length !== 1) {
      notes.push(person);
    }
  }
  return { rows, notes };
}

/** "Joined from one shared account: Ann and Sam, 2 voices" */
export const noteText = (tile: Pick<ParticipantDto, 'name'>, voices: number) =>
  `Joined from one shared account: ${tile.name}, ${String(voices)} ${voices === 1 ? 'voice' : 'voices'}`;

/** Where a sub-person can go, or undefined when they are unnamed. */
export const personHref = (sub: Pick<SubPersonDto, 'personId' | 'unnamed'>) =>
  sub.unnamed ? undefined : `#/people/${sub.personId}`;

export type SplitProgress = 'working' | 'done' | 'failed';

/** How long the page keeps asking while a split is worked on. */
export const SPLIT_POLL_MS = 3000;
export const SPLIT_GIVE_UP_MS = 90_000;

/**
 * Where a split stands: done when the tile has its people and no split is running, failed when
 * nothing came of it in time, else still working.
 */
export function splitProgress(
  room: Pick<RoomGroupDto, 'splitting' | 'subs'> | undefined,
  startedAt: number,
  now: number,
): SplitProgress {
  if (room && !room.splitting && room.subs.length > 0) return 'done';
  return now - startedAt >= SPLIT_GIVE_UP_MS ? 'failed' : 'working';
}

export const splitFailedText =
  'No separate voices could be found. The audio may be missing, or the voices sound too alike.';

export interface InviteeChoice {
  invitee: InviteeDto;
  /** This sub-person has it. */
  mine: boolean;
  /** The name of the other person (of the same tile, or any participant) who has it. */
  takenBy: string | null;
}

/** Someone in the meeting who may already have an invitee linked. */
export interface InviteeHolder {
  name: string;
  inviteeEmails: readonly string[];
}

/**
 * Every invitee of the meeting for one sub-person, whether or not it is in the "Unable to attend"
 * list, saying who has it when it is linked to someone else. Such an invitee can still be ticked:
 * it is then moved here.
 */
export function inviteeChoices(
  invitees: readonly InviteeDto[],
  sub: Pick<SubPersonDto, 'voiceId' | 'inviteeEmails'>,
  subs: readonly Pick<SubPersonDto, 'voiceId' | 'name' | 'inviteeEmails'>[],
  others: readonly InviteeHolder[] = [],
): InviteeChoice[] {
  return invitees.map((invitee) => {
    const email = invitee.email.toLowerCase();
    const has = (list: readonly string[]) => list.some((own) => own.toLowerCase() === email);
    const owner =
      subs.find((other) => other.voiceId !== sub.voiceId && has(other.inviteeEmails)) ??
      others.find((other) => has(other.inviteeEmails));
    return {
      invitee,
      mine: has(sub.inviteeEmails),
      takenBy: owner?.name ?? null,
    };
  });
}

/** True when ticking these would take an invitee from someone else. */
export const needsMove = (choices: readonly InviteeChoice[], ticked: readonly string[]) =>
  choices.some(
    (choice) =>
      choice.takenBy !== null &&
      ticked.some((email) => email.toLowerCase() === choice.invitee.email.toLowerCase()),
  );

/** One place an invitee can be linked to: a person of a shared tile, or a participant. */
export interface LinkTarget {
  participantId: string;
  label: string;
}

/** The targets of "They were there", the people of shared tiles grouped under their tile. */
export interface LinkTargets {
  groups: { tile: string; targets: LinkTarget[] }[];
  singles: LinkTarget[];
}

/**
 * The people an invitee can be. A shared tile is not a person: when it has people, those are
 * offered under its name and the tile itself is left out; a tile still waiting for its question
 * is offered as it is.
 */
export function linkTargets(participants: readonly ParticipantDto[]): LinkTargets {
  const groups: LinkTargets['groups'] = [];
  const singles: LinkTarget[] = [];
  for (const person of participants) {
    const subs = person.room?.subs ?? [];
    if (subs.length > 0) {
      groups.push({
        tile: person.name,
        targets: orderSubs(subs).map((sub) => ({
          participantId: sub.participantId,
          label: sub.name,
        })),
      });
    } else {
      singles.push({
        participantId: person.id,
        label: person.originalName ? `${person.name} (${person.originalName})` : person.name,
      });
    }
  }
  return { groups, singles };
}

/** The participants of the meeting, tiles too, that may hold an invitee link. */
export const holdersOf = (
  participants: readonly Pick<ParticipantDto, 'name' | 'inviteeEmails'>[],
): InviteeHolder[] =>
  participants.map((person) => ({ name: person.name, inviteeEmails: person.inviteeEmails }));

export type TileEmailState =
  | { kind: 'none' }
  | { kind: 'free'; email: string }
  | { kind: 'mine'; email: string }
  | { kind: 'taken'; email: string; by: string };

/** Whether the account's own address can be given to this sub-person. */
export function tileEmailState(
  room: Pick<RoomGroupDto, 'tileEmail' | 'subs'>,
  sub: Pick<SubPersonDto, 'voiceId' | 'email'>,
): TileEmailState {
  const email = room.tileEmail?.toLowerCase();
  if (!email) return { kind: 'none' };
  if (sub.email?.toLowerCase() === email) return { kind: 'mine', email };
  const holder = room.subs.find(
    (other) => other.voiceId !== sub.voiceId && other.email?.toLowerCase() === email,
  );
  return holder ? { kind: 'taken', email, by: holder.name } : { kind: 'free', email };
}

/** The body to name a voice: an existing person, or a name typed or taken from the meeting. */
export const nameBody = (option: PickerOption): { personId: string } | { name: string } =>
  option.personId ? { personId: option.personId } : { name: option.name };

/** "Ann and Sam, 2 people" */
export const accountText = (account: Pick<SharedAccountDto, 'label' | 'count'>) =>
  `${account.label}, ${String(account.count)} people`;

/** What the wait setting says in words. */
export function waitSettingText(minutes: number): string {
  if (minutes <= 0) return 'The summary never waits. It uses the number of voices found.';
  return `The summary waits up to ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'} for the answer. The transcript and everything else go on meanwhile.`;
}

/** Reads the minutes field: a whole number from 0 to 1440, else undefined. */
export function parseWaitMinutes(text: string): number | undefined {
  if (!/^\d{1,4}$/.test(text.trim())) return undefined;
  const value = Number(text);
  return value <= 24 * 60 ? value : undefined;
}

/**
 * The invitees of the meeting as people to pick for a voice. Someone who has the address in
 * People is picked as that person, else a new person is made with the name of the invite (or one
 * derived from the address). An invitee the current person has is left out; one that another
 * person of the meeting has is listed only with `includeTaken`, and picking it moves it.
 */
export function invitedOptions(
  choices: readonly InviteeChoice[],
  known: readonly { id: string; name: string; emails?: string[] | undefined }[],
  current: { personId?: string | undefined; inviteeEmails?: readonly string[] | undefined } = {},
  includeTaken = false,
): InvitedOption[] {
  const mine = new Set((current.inviteeEmails ?? []).map((e) => e.toLowerCase()));
  return choices.flatMap(({ invitee, takenBy }) => {
    const email = invitee.email.toLowerCase();
    if (mine.has(email) || (takenBy !== null && !includeTaken)) return [];
    const person = known.find((p) => p.emails?.some((own) => own.toLowerCase() === email));
    if (person && person.id === current.personId) return [];
    const name = person?.name ?? invitee.name?.trim() ?? nameFromEmail(invitee.email);
    return [
      {
        email: invitee.email,
        label: `${name} (${invitee.email})`,
        option: { personId: person?.id ?? null, name, email: invitee.email },
        takenBy,
      },
    ];
  });
}
