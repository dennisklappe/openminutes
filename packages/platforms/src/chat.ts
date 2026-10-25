import type { ChatMessage } from './types.js';

export interface RawChatMessage {
  sender: string;
  text: string;
  time: string | null;
  hrefs: string[];
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

export function extractLinks(text: string, hrefs: string[] = []): string[] {
  const found = [...hrefs, ...(text.match(URL_IN_TEXT) ?? [])]
    .map((candidate) => candidate.replace(TRAILING_PUNCTUATION, ''))
    .filter((candidate) => {
      try {
        const { protocol } = new URL(candidate);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    });
  return [...new Set(found)];
}

export function toChatMessages(raw: RawChatMessage[]): ChatMessage[] {
  return raw.flatMap(({ sender, text, time, hrefs }) => {
    const body = text.replace(/\s+/g, ' ').trim();
    return sender && body ? [{ sender, text: body, time, links: extractLinks(body, hrefs) }] : [];
  });
}
