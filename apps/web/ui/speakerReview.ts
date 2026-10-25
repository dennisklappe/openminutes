import type { SegmentDto } from '../src/dto.js';

export const uncertainSegments = (segments: readonly SegmentDto[]) =>
  segments.filter((segment) => segment.uncertain);

/** The next (or previous) uncertain line after the cursor, wrapping around. */
export function stepUncertain(
  segments: readonly SegmentDto[],
  cursorId: string | null,
  direction: 1 | -1,
): string | null {
  const cursor = segments.findIndex((segment) => segment.id === cursorId);
  const ordered = direction === 1 ? segments : [...segments].reverse();
  const from = cursor === -1 ? -1 : direction === 1 ? cursor : segments.length - 1 - cursor;
  const candidates = [...ordered.slice(from + 1), ...ordered.slice(0, from + 1)];
  return candidates.find((segment) => segment.uncertain)?.id ?? null;
}
