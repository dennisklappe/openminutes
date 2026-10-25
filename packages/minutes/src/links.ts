import { chatParts, urlsIn } from './chat.js';
import type { LinkEntry, RenderOptions } from './options.js';
import type { Minutes } from './types.js';

export interface ChatLink {
  sender: string;
  url: string;
}

export interface LinkGroups {
  documents: LinkEntry[];
  /** Web links in the summary, such as its resources. */
  summary: string[];
  chat: ChatLink[];
}

export const CHAT_TITLE = 'Chat';
export const LINKS_TITLE = 'Links';
export const DOCUMENT_LINKS_TITLE = 'Share link / documents';
export const SUMMARY_LINKS_TITLE = 'Mentioned in the minutes';
export const CHAT_LINKS_TITLE = 'Shared in the meeting chat';

/** What the Links tab holds, or undefined when there is no such tab or nothing to list. */
export function linkGroups(minutes: Minutes, options: RenderOptions): LinkGroups | undefined {
  if (!options.linksTab) return undefined;
  const seen = new Set<string>();
  const fresh = (url: string) => !seen.has(url) && !!seen.add(url);
  const documents = (options.links ?? []).filter((entry) => fresh(entry.url));
  const summary = urlsIn(minutes.summary ?? '').filter(fresh);
  const chat = minutes.chat.flatMap((message) =>
    chatParts(message).flatMap((part) =>
      part.href && fresh(part.href) ? [{ sender: message.sender, url: part.href }] : [],
    ),
  );
  return documents.length + summary.length + chat.length > 0
    ? { documents, summary, chat }
    : undefined;
}
