import type {
  SegmentDto,
  SpeakerChoiceDto,
  SpeakerEditInput,
  SpeakerTargetInput,
} from '../src/dto.js';

export type Scope = 'line' | 'following' | 'block';

export const scopeLabels: Record<Scope, string> = {
  line: 'Only this line',
  following: 'This and following lines until the speaker changes',
  block: 'All lines in this block',
};

const holder = (segment: SegmentDto) => segment.speakerId ?? segment.speaker;

function scopeRange(segments: readonly SegmentDto[], at: number, scope: Scope): [number, number] {
  const clicked = segments[at];
  const sameHolder = (index: number) => {
    const other = segments[index];
    return clicked !== undefined && other !== undefined && holder(other) === holder(clicked);
  };
  let start = at;
  let end = at;
  while (sameHolder(start - 1)) start -= 1;
  while (sameHolder(end + 1)) end += 1;
  if (scope === 'line') return [at, at];
  return scope === 'following' ? [at, end] : [start, end];
}

export function scopeIds(segments: readonly SegmentDto[], id: string, scope: Scope): string[] {
  const at = segments.findIndex((segment) => segment.id === id);
  if (at === -1) return [];
  const [start, end] = scopeRange(segments, at, scope);
  return segments.slice(start, end + 1).map((segment) => segment.id);
}

/** Scopes that reach a different set of lines than the one before, so the menu never offers duplicates. */
export function scopeChoices(segments: readonly SegmentDto[], id: string): Scope[] {
  const scopes: Scope[] = ['line', 'following', 'block'];
  let previous = 0;
  return scopes.filter((scope) => {
    const size = scopeIds(segments, id, scope).length;
    const wider = size > previous;
    previous = Math.max(previous, size);
    return wider;
  });
}

export function neighbours(segments: readonly SegmentDto[], id: string) {
  const at = segments.findIndex((segment) => segment.id === id);
  return { previous: segments[at - 1] ?? null, next: segments[at + 1] ?? null };
}

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== '');
}

export function splitParts(words: readonly string[], gap: number): [string, string] {
  return [words.slice(0, gap).join(' '), words.slice(gap).join(' ')];
}

/** The first other known speaker, otherwise a new one. */
export function otherSpeaker(
  choices: readonly SpeakerChoiceDto[],
  currentId: string | null,
): SpeakerTargetInput {
  const other = choices.find((choice) => choice.id !== currentId);
  return other ? { id: other.id } : { create: true };
}

export function uncertaintyLabel(segment: SegmentDto): string {
  return segment.speakerConfidence === null
    ? 'Speaker uncertain'
    : `Speaker uncertain: ${String(Math.round(segment.speakerConfidence * 100))}%`;
}

export function editMessage(input: SpeakerEditInput): string {
  if (input.kind === 'split') return 'Line split.';
  if (input.kind === 'merge') return 'Lines merged.';
  return 'Speaker changed.';
}
