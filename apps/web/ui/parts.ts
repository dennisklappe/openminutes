import type { MinutesParts } from '../src/dto.js';

export const noParts: MinutesParts = {
  includeTranscript: false,
  includeChat: false,
  includeLinks: false,
};

/** "Minutes + transcript": what an output holds, for people. */
export function partsLabel(parts: MinutesParts): string {
  return [
    'Minutes',
    ...(parts.includeTranscript ? ['transcript'] : []),
    ...(parts.includeChat ? ['chat'] : []),
    ...(parts.includeLinks ? ['links'] : []),
  ].join(' + ');
}

export const samePartsAs = (a: MinutesParts, b: MinutesParts) =>
  a.includeTranscript === b.includeTranscript &&
  a.includeChat === b.includeChat &&
  a.includeLinks === b.includeLinks;

/** Parts that cannot be ticked because the meeting has nothing for them stay off. */
export function availableParts(
  parts: MinutesParts,
  has: { transcript: boolean; chat: boolean; links: boolean },
): MinutesParts {
  return {
    includeTranscript: parts.includeTranscript && has.transcript,
    includeChat: parts.includeChat && has.chat,
    includeLinks: parts.includeLinks && has.links,
  };
}
