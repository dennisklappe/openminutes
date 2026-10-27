import type { PersonChoiceDto, ReviewLineDto, ReviewRosterDto } from '../src/dto.js';

/** What the reviewer did with one line. */
export type Decision =
  | { kind: 'skip' }
  | { kind: 'approve' }
  /** Not the proposed person: someone from the meeting or the people list, or a new name. */
  | { kind: 'move'; personId: string; name: string }
  | { kind: 'create'; name: string }
  /** Not the proposed person and nobody in particular. */
  | { kind: 'reject' };

export interface Entry {
  line: ReviewLineDto;
  decision: Decision;
}

export interface ReviewState {
  /** Still to look at, in order. The first is on screen. */
  rest: ReviewLineDto[];
  skipped: ReviewLineDto[];
  /** Everything decided in this session, oldest first. */
  history: Entry[];
  total: number;
}

export const startReview = (lines: readonly ReviewLineDto[]): ReviewState => ({
  rest: [...lines],
  skipped: [],
  history: [],
  total: lines.length,
});

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
  approved: state.history.filter((e) => e.decision.kind === 'approve').length,
  changed: state.history.filter((e) => ['move', 'create', 'reject'].includes(e.decision.kind))
    .length,
  skipped: state.skipped.length,
});

/** What the live region says after a decision. */
export function describeDecision({ line, decision }: Entry): string {
  switch (decision.kind) {
    case 'approve':
      return `Approved: ${line.proposed.name}.`;
    case 'move':
      return `Moved to ${decision.name}.`;
    case 'create':
      return `Moved to new person ${decision.name}.`;
    case 'reject':
      return `Not ${line.proposed.name}.`;
    case 'skip':
      return 'Skipped.';
  }
}

export interface ReviewApi {
  verifyLine: (personId: string, segmentId: string) => Promise<unknown>;
  rejectLine: (personId: string, segmentId: string) => Promise<unknown>;
  moveLine: (personId: string, segmentId: string, target: string) => Promise<unknown>;
  createPerson: (body: { name: string }) => Promise<{ person: { id: string } }>;
}

/** Sends one decision with the endpoints the person page uses. A skip sends nothing. */
export async function commit(api: ReviewApi, { line, decision }: Entry): Promise<void> {
  const from = line.proposed.id;
  switch (decision.kind) {
    case 'skip':
      return;
    case 'approve':
      await api.verifyLine(from, line.id);
      return;
    case 'reject':
      await api.rejectLine(from, line.id);
      return;
    case 'move':
      await api.moveLine(from, line.id, decision.personId);
      return;
    case 'create': {
      const { person } = await api.createPerson({ name: decision.name });
      await api.moveLine(from, line.id, person.id);
    }
  }
}

export interface PickerOption {
  /** Null for a meeting participant who is not a saved person yet. */
  personId: string | null;
  name: string;
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
      : people.find((person) => same(person.name, entry.name));
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
    .map((person) => ({ personId: person.id, name: person.name }));
}

/** The decision for a picked option. */
export const pick = (option: PickerOption): Decision =>
  option.personId === null
    ? { kind: 'create', name: option.name }
    : { kind: 'move', personId: option.personId, name: option.name };

export type ReviewKey = 'approve' | 'disapprove' | 'skip' | 'undo' | 'exit' | { pick: number };

/** What a key does. While the picker is open only Escape and the numbers act. */
export function keyAction(
  key: string,
  picker: 'closed' | 'roster' | 'other',
): ReviewKey | undefined {
  const lower = key.length === 1 ? key.toLowerCase() : key;
  if (lower === 'Escape') return 'exit';
  if (picker === 'roster' && /^[1-9]$/.test(lower)) return { pick: Number(lower) - 1 };
  if (picker !== 'closed') return undefined;
  if (lower === 'ArrowRight' || lower === 'a') return 'approve';
  if (lower === 'ArrowLeft' || lower === 'd') return 'disapprove';
  if (lower === 'ArrowDown' || lower === 's') return 'skip';
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
