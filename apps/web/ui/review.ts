import type {
  PersonChoiceDto,
  ReviewLineDto,
  ReviewRosterDto,
  ReviewVoiceDto,
} from '../src/dto.js';

/** One card of the queue: a line to check, or a voice that does not match its label. */
export type ReviewCard = ReviewLineDto | ReviewVoiceDto;

export const isVoiceCard = (card: ReviewCard): card is ReviewVoiceDto => 'lines' in card;

/** The person a card is about: the proposed one for a line, the labelled one for a voice. */
export const cardPerson = (card: ReviewCard): PersonChoiceDto =>
  isVoiceCard(card) ? card.person : card.proposed;

/** Drops every line proposed for one person, such as after they are marked do not track. */
export function dropPerson(state: ReviewState, personId: string): ReviewState {
  const keep = (card: ReviewCard) => cardPerson(card).id !== personId;
  const rest = state.rest.filter(keep);
  const skipped = state.skipped.filter(keep);
  return {
    ...state,
    rest,
    skipped,
    total:
      state.total - (state.rest.length - rest.length) - (state.skipped.length - skipped.length),
  };
}

/** What the reviewer did with one line. */
export type Decision =
  | { kind: 'skip' }
  | { kind: 'approve' }
  /** A voice card: yes, the labelled voice is the person. */
  | { kind: 'confirm' }
  /** Not the proposed person: someone from the meeting or the people list, or a new name. */
  | { kind: 'move'; personId: string; name: string }
  | { kind: 'create'; name: string }
  /** Not the proposed person and nobody in particular. */
  | { kind: 'reject' }
  /** The line holds two or three speakers: cut before the words at `cuts`, one person per part. */
  | { kind: 'split'; cuts: number[]; people: PickerOption[] }
  /** The line holds two speakers and must not train a voice. It keeps its label. */
  | { kind: 'mixed' };

export interface Entry {
  line: ReviewCard;
  decision: Decision;
}

export interface ReviewState {
  /** Still to look at, in order. The first is on screen. */
  rest: ReviewCard[];
  skipped: ReviewCard[];
  /** Everything decided in this session, oldest first. */
  history: Entry[];
  total: number;
}

export const startReview = (lines: readonly ReviewCard[]): ReviewState => ({
  rest: [...lines],
  skipped: [],
  history: [],
  total: lines.length,
});

/**
 * Puts the card with this id on screen, the others keep their order behind it. Undefined when
 * the card is no longer to be looked at: decided, skipped or not in this queue. A voice card
 * is looked up among the voices only, a line among the lines.
 */
export function focusLine(state: ReviewState, id: string, voice = false): ReviewState | undefined {
  const found = state.rest.find((card) => card.id === id && isVoiceCard(card) === voice);
  if (!found) return undefined;
  return { ...state, rest: [found, ...state.rest.filter((card) => card !== found)] };
}

export const currentLine = (state: ReviewState) => state.rest[0];

/** The 1-based place of the line on screen, for "3 of 12". */
export const position = (state: ReviewState) => Math.min(state.history.length + 1, state.total);

export function decide(state: ReviewState, decision: Decision): ReviewState {
  const [line, ...rest] = state.rest;
  if (!line) return state;
  return {
    ...state,
    rest,
    skipped: decision.kind === 'skip' ? [...state.skipped, line] : state.skipped,
    history: [...state.history, { line, decision }],
  };
}

/** Puts the last decision back on screen. */
export function undo(state: ReviewState): ReviewState {
  const last = state.history.at(-1);
  if (!last) return state;
  return {
    ...state,
    rest: [last.line, ...state.rest],
    skipped:
      last.decision.kind === 'skip'
        ? state.skipped.filter((line) => line.id !== last.line.id)
        : state.skipped,
    history: state.history.slice(0, -1),
  };
}

/** Puts a decision that could not be sent back at the front, so it is looked at again. */
export function restore(state: ReviewState, entry: Entry): ReviewState {
  if (!state.history.includes(entry)) return state;
  return {
    ...state,
    rest: [entry.line, ...state.rest],
    history: state.history.filter((e) => e !== entry),
  };
}

/** Brings the skipped lines back for another pass. */
export function reviewSkipped(state: ReviewState): ReviewState {
  return {
    rest: state.skipped,
    skipped: [],
    history: state.history.filter((entry) => entry.decision.kind !== 'skip'),
    total: state.skipped.length + state.history.filter((e) => e.decision.kind !== 'skip').length,
  };
}

export const counts = (state: ReviewState) => ({
  approved: state.history.filter((e) => ['approve', 'confirm'].includes(e.decision.kind)).length,
  changed: state.history.filter((e) =>
    ['move', 'create', 'reject', 'split'].includes(e.decision.kind),
  ).length,
  mixed: state.history.filter((e) => e.decision.kind === 'mixed').length,
  skipped: state.skipped.length,
});

/** What the live region says after a decision. */
export function describeDecision({ line, decision }: Entry): string {
  switch (decision.kind) {
    case 'approve':
      return `Approved: ${cardPerson(line).name}.`;
    case 'confirm':
      return `Confirmed: this voice is ${cardPerson(line).name}.`;
    case 'move':
      return `Moved to ${decision.name}.`;
    case 'create':
      return `Moved to new person ${decision.name}.`;
    case 'reject':
      return `Not ${cardPerson(line).name}.`;
    case 'skip':
      return 'Skipped.';
    case 'split':
      return `Split into ${String(decision.cuts.length + 1)} lines.`;
    case 'mixed':
      return 'Marked as mixed, kept out of voice training.';
  }
}

export interface ReviewApi {
  skipLine: (personId: string, segmentId: string) => Promise<unknown>;
  undoReviewDecision: (segmentId: string) => Promise<unknown>;
  verifyLine: (personId: string, segmentId: string) => Promise<unknown>;
  rejectLine: (personId: string, segmentId: string) => Promise<unknown>;
  moveLine: (personId: string, segmentId: string, target: string) => Promise<unknown>;
  createPerson: (body: { name: string }) => Promise<{ person: { id: string } }>;
  splitLine: (
    personId: string,
    segmentId: string,
    body: { cuts: number[]; personIds: string[] },
  ) => Promise<unknown>;
  markMixed: (personId: string, segmentId: string) => Promise<unknown>;
  confirmVoice: (id: string) => Promise<unknown>;
  moveVoice: (id: string, personId: string) => Promise<unknown>;
  skipVoice: (id: string) => Promise<unknown>;
  reopenVoice: (id: string) => Promise<unknown>;
}

/** A sent decision the server can take back: lines always, a voice only when it was skipped. */
export const undoable = ({ line, decision }: Entry) =>
  !isVoiceCard(line) || decision.kind === 'skip';

/**
 * Sends one decision at once, with the endpoints the person page uses. A skip is stored too, so
 * the line does not come back after a refresh.
 */
export async function commit(api: ReviewApi, { line, decision }: Entry): Promise<void> {
  if (isVoiceCard(line)) {
    switch (decision.kind) {
      case 'skip':
        await api.skipVoice(line.id);
        return;
      case 'confirm':
        await api.confirmVoice(line.id);
        return;
      case 'move':
        await api.moveVoice(line.id, decision.personId);
        return;
      default:
        throw new Error('That choice does not fit a voice card.');
    }
  }
  const from = line.proposed.id;
  switch (decision.kind) {
    case 'skip':
      await api.skipLine(from, line.id);
      return;
    case 'approve':
      await api.verifyLine(from, line.id);
      return;
    case 'confirm':
      throw new Error('That choice does not fit a line.');
    case 'reject':
      await api.rejectLine(from, line.id);
      return;
    case 'move':
      await api.moveLine(from, line.id, decision.personId);
      return;
    case 'create': {
      const { person } = await api.createPerson({ name: decision.name });
      await api.moveLine(from, line.id, person.id);
      return;
    }
    case 'mixed':
      await api.markMixed(from, line.id);
      return;
    case 'split': {
      // Someone who is only a name in this meeting is made a person once, however many parts they get.
      const made = new Map<string, string>();
      const personIds: string[] = [];
      for (const option of decision.people) {
        if (option.personId) {
          personIds.push(option.personId);
          continue;
        }
        const key = option.name.toLowerCase();
        let id = made.get(key);
        if (!id) {
          id = (await api.createPerson({ name: option.name })).person.id;
          made.set(key, id);
        }
        personIds.push(id);
      }
      await api.splitLine(from, line.id, { cuts: decision.cuts, personIds });
    }
  }
}

/** Takes a sent decision back on the server, so the line is open again. */
export async function uncommit(api: ReviewApi, { line, decision }: Entry): Promise<void> {
  if (isVoiceCard(line)) {
    if (decision.kind !== 'skip') throw new Error('A decision on a voice cannot be undone.');
    await api.reopenVoice(line.id);
    return;
  }
  await api.undoReviewDecision(line.id);
}

export interface PickerOption {
  /** Null for a meeting participant who is not a saved person yet. */
  personId: string | null;
  name: string;
  /** Marked do not track: shown only in the full list. */
  untracked?: boolean;
  /** Set for an invitee of the meeting: this address goes to the picked person only. */
  email?: string;
}

/** An invitee of the meeting offered as "Who is this?". */
export interface InvitedOption {
  email: string;
  /** "Name (address)", with a name from the invite or derived from the address. */
  label: string;
  option: PickerOption;
  /** The name of the one who has this address now. Picking then moves it. */
  takenBy: string | null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Who a disapproved line can go to. A meeting participant without a person is matched to a saved
 * person of the same name, so choosing them never makes a double.
 */
export function rosterOptions(
  roster: readonly ReviewRosterDto[],
  people: readonly PersonChoiceDto[],
  proposedId: string,
): PickerOption[] {
  const seen = new Set<string>();
  const options: PickerOption[] = [];
  for (const entry of roster) {
    const match = entry.personId
      ? undefined
      : people.find((person) => person.tracked !== false && same(person.name, entry.name));
    const personId = entry.personId ?? match?.id ?? null;
    if (personId === proposedId) continue;
    const key = personId ?? `name:${entry.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ personId, name: entry.name });
  }
  return options;
}

/** The full people list for the "Someone else" fallback, filtered by what was typed. */
export function everyoneOptions(
  people: readonly PersonChoiceDto[],
  proposedId: string,
  query: string,
): PickerOption[] {
  const needle = query.trim().toLowerCase();
  return people
    .filter((person) => person.id !== proposedId && person.name.toLowerCase().includes(needle))
    .map((person) => ({
      personId: person.id,
      name: person.name,
      ...(person.tracked === false && { untracked: true }),
    }));
}

/** The decision for a picked option. */
export const pick = (option: PickerOption): Decision =>
  option.personId === null
    ? { kind: 'create', name: option.name }
    : { kind: 'move', personId: option.personId, name: option.name };

export type ReviewKey =
  'approve' | 'disapprove' | 'skip' | 'split' | 'mixed' | 'undo' | 'exit' | { pick: number };

/** What a key does. While the picker is open only Escape and the numbers act. */
export function keyAction(
  key: string,
  picker: 'closed' | 'roster' | 'other' | 'split',
): ReviewKey | undefined {
  const lower = key.length === 1 ? key.toLowerCase() : key;
  if (lower === 'Escape') return 'exit';
  if (picker === 'roster' && /^[1-9]$/.test(lower)) return { pick: Number(lower) - 1 };
  if (picker !== 'closed') return undefined;
  if (lower === 'ArrowRight' || lower === 'a') return 'approve';
  if (lower === 'ArrowLeft' || lower === 'd') return 'disapprove';
  if (lower === 'ArrowDown' || lower === 's') return 'skip';
  if (lower === 'x') return 'split';
  if (lower === 'm') return 'mixed';
  if (lower === 'u') return 'undo';
  return undefined;
}

export function confidenceLabel(line: Pick<ReviewLineDto, 'speakerConfidence' | 'voiceScore'>) {
  const percent = (value: number) => `${String(Math.round(value * 100))}%`;
  const parts: string[] = [];
  parts.push(
    line.speakerConfidence === null
      ? 'Confidence unknown'
      : `${percent(line.speakerConfidence)} sure`,
  );
  if (line.voiceScore !== null) parts.push(`voice fits ${percent(line.voiceScore)}`);
  return parts.join(', ');
}

/** Scores closer than this are too close to tell apart. */
export const CLOSE_MARGIN = 0.1;

export interface VoiceSays {
  name: string;
  score: number;
  /** This is the person the line is labelled as. */
  labelled: boolean;
}

export interface CardStory {
  /** Who the voice points at, best first. Empty when only the labelled person was scored. */
  voice: VoiceSays[];
  /** Where the label comes from. */
  source: 'the call' | 'the speaker check';
  /** Why the line is asked about, in plain words. */
  reason: string;
  /** The best scoring person is not the label and the two are close: maybe two speakers. */
  splitHint: boolean;
}

/** "JP Kroon 49%". */
export const scoreLabel = (who: Pick<VoiceSays, 'name' | 'score'>) =>
  `${who.name} ${String(Math.round(who.score * 100))}%`;

/**
 * What a review card says in plain words: the label, what the voice says about everyone scored
 * (the best first, even when that is not the label), and why the line is asked about.
 */
export function cardStory(
  line: Pick<
    ReviewLineDto,
    | 'proposed'
    | 'proposedScore'
    | 'considered'
    | 'speakerConfidence'
    | 'voiceScore'
    | 'reason'
    | 'why'
  >,
): CardStory {
  const own = line.proposedScore ?? line.voiceScore ?? line.speakerConfidence;
  const voice: VoiceSays[] =
    line.considered.length === 0 || own === null
      ? []
      : [
          { name: line.proposed.name, score: own, labelled: true },
          ...line.considered.map((c) => ({ name: c.name, score: c.score, labelled: false })),
        ].sort((a, b) => b.score - a.score);
  const [top, next] = voice;
  const elsewhere = top !== undefined && !top.labelled;
  const gap = elsewhere && own !== null ? top.score - own : 1;
  const close = elsewhere
    ? gap < CLOSE_MARGIN
    : top !== undefined && next !== undefined && top.score - next.score < CLOSE_MARGIN;

  let reason: string;
  if (line.reason === 'mixed') reason = 'Probably two speakers';
  else if (elsewhere) reason = close ? 'Too close to call' : 'The voice disagrees with the label';
  else if (close) reason = 'Too close to call';
  else if (line.reason === 'voice')
    reason = 'New environment: the voice does not fit the profile yet';
  else if (line.reason === 'elimination')
    reason = 'By elimination: the voice fits nobody else here';
  else if (line.reason === 'suggested') reason = 'The speaker check suggests this person';
  else if (line.reason === 'training' || line.why === 'training') {
    reason = 'Not enough voice yet: an approval adds to the profile';
  } else reason = 'Not sure who this is';

  return {
    voice,
    source: line.reason === 'suggested' ? 'the speaker check' : 'the call',
    reason,
    splitHint: elsewhere && close && line.reason !== 'mixed',
  };
}

/** "Dennis: 45 s of 90 s, Dutch", how far the voice profile is from good enough. */
export const coverageLabel = (
  line: Pick<
    ReviewLineDto,
    'proposed' | 'profileSeconds' | 'profileTargetSeconds' | 'languageName'
  >,
) =>
  line.profileSeconds >= line.profileTargetSeconds
    ? `${line.proposed.name}: enough voice, ${String(line.profileSeconds)} s, ${line.languageName}`
    : `${line.proposed.name}: ${String(line.profileSeconds)} s of ${String(line.profileTargetSeconds)} s, ${line.languageName}`;

/** The words of a line split into its parts, before the words at `cuts`. */
export function splitIntoParts(words: readonly string[], cuts: readonly number[]): string[][] {
  const edges = [0, ...cuts, words.length];
  return edges.slice(0, -1).map((from, i) => words.slice(from, edges[i + 1]));
}

/**
 * The cuts after a word is clicked. A click moves the nearest cut, or adds one when `again` is
 * set (at most two cuts). Word 0 cannot be a cut, nothing would be left before it.
 */
export function clickWord(cuts: readonly number[], word: number, again: boolean): number[] {
  if (word < 1) return [...cuts];
  if (cuts.includes(word)) return cuts.filter((cut) => cut !== word);
  if (cuts.length === 0 || (again && cuts.length < 2)) return [...cuts, word].sort((a, b) => a - b);
  const nearest = cuts.reduce((best, cut) =>
    Math.abs(cut - word) < Math.abs(best - word) ? cut : best,
  );
  return cuts.map((cut) => (cut === nearest ? word : cut)).sort((a, b) => a - b);
}

/**
 * Who says each part to begin with: the proposed person for the first, the first other person of
 * the meeting for the second, and for a third part the person of the first again.
 */
export function defaultPeople(
  proposed: PickerOption,
  roster: readonly PickerOption[],
  parts: number,
): PickerOption[] {
  const other = roster[0] ?? proposed;
  return Array.from({ length: parts }, (_, i) => (i === 1 ? other : proposed));
}

/** Everyone a part can go to: the proposed person first, then the others of the meeting. */
export const splitOptions = (
  proposed: PickerOption,
  roster: readonly PickerOption[],
): PickerOption[] => [proposed, ...roster];

export const optionKey = (option: PickerOption) => option.personId ?? `name:${option.name}`;
