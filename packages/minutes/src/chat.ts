import type { RenderOptions } from './options.js';
import type { Minutes, MinutesChatMessage } from './types.js';

interface ChatPart {
  text: string;
  href?: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]'"]+$/;

const isWebUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** Chat is its own part (a tab or section) and only there when asked for and the meeting has any. */
export const showsChat = (minutes: Minutes, options: Pick<RenderOptions, 'includeChat'>) =>
  options.includeChat === true && minutes.chat.length > 0;

/** Web links in a text, in order, without trailing punctuation. */
export function urlsIn(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)]
    .map((match) => match[0].replace(TRAILING_PUNCTUATION, ''))
    .filter(isWebUrl);
}

/** The message as text and links, with links that are not in the text appended. */
export function chatParts(message: MinutesChatMessage): ChatPart[] {
  const text = message.text.replace(/\s+/g, ' ').trim();
  const parts: ChatPart[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    if (!isWebUrl(url)) continue;
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    parts.push({ text: url, href: url });
    seen.add(url);
    cursor = match.index + url.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  for (const link of message.links) {
    if (seen.has(link) || !isWebUrl(link)) continue;
    seen.add(link);
    parts.push({ text: ' ' }, { text: link, href: link });
  }
  return parts;
}
