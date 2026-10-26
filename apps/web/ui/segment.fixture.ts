import type { SegmentDto } from '../src/dto.js';

export const makeSegment = (overrides: Partial<SegmentDto> & { id: string }): SegmentDto => ({
  startMs: 0,
  endMs: 1000,
  text: overrides.id,
  speaker: null,
  speakerId: null,
  speakerConfidence: null,
  speakerSource: null,
  uncertain: false,
  previousSpeaker: null,
  suggestedSpeaker: null,
  suggestedSpeakerId: null,
  ...overrides,
});
