import type { SegmentDto } from '../src/dto.js';

export const SPEAKER_COLORS = 8;

export function speakerSlots(segments: readonly { speaker: string | null }[]): Map<string, number> {
  const slots = new Map<string, number>();
  for (const { speaker } of segments) {
    if (speaker !== null && !slots.has(speaker)) slots.set(speaker, slots.size % SPEAKER_COLORS);
  }
  return slots;
}

export function talkTime(segments: readonly SegmentDto[]) {
  const slots = speakerSlots(segments);
  const spoken = new Map<string, number>();
  for (const { speaker, startMs, endMs } of segments) {
    if (speaker !== null) spoken.set(speaker, (spoken.get(speaker) ?? 0) + endMs - startMs);
  }
  const total = [...spoken.values()].reduce((a, b) => a + b, 0) || 1;
  return [...slots].map(([name, slot]) => ({ name, slot, share: (spoken.get(name) ?? 0) / total }));
}
