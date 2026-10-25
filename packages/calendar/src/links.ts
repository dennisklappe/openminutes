import { parseMeetingLink } from '@openminutes/core';
import type { MeetingLink } from './types.js';

const CANDIDATE = /(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#][^\s<>"'\\]*)?/gi;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code =
        entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return String.fromCodePoint(code);
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function extractJoinLink(
  candidates: readonly (string | null | undefined)[],
): MeetingLink | undefined {
  for (const text of candidates) {
    if (!text) continue;
    for (const match of decodeEntities(text).matchAll(CANDIDATE)) {
      const link = parseMeetingLink(match[0].replace(/[.,;:)\]]+$/, ''));
      if (link) return { platform: link.platform, url: link.canonicalUrl };
    }
  }
  return undefined;
}
