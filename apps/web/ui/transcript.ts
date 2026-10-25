import type { ChatMessageDto, SegmentDto } from '../src/dto.js';

export type TranscriptEntry =
  | { kind: 'segment'; at: number; segment: SegmentDto }
  | { kind: 'chat'; at: number; message: ChatMessageDto };

export type TextPart =
  { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

export function mergeTranscript(
  segments: readonly SegmentDto[],
  chat: readonly ChatMessageDto[],
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [
    ...segments.map((segment) => ({ kind: 'segment' as const, at: segment.startMs, segment })),
    ...chat.map((message) => ({ kind: 'chat' as const, at: message.offsetMs, message })),
  ];
  return entries.sort((a, b) => a.at - b.at);
}

function safeHref(candidate: string): string | undefined {
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  const push = (part: TextPart) => {
    const last = parts.at(-1);
    if (part.kind === 'text' && last?.kind === 'text') last.text += part.text;
    else if (part.text !== '') parts.push(part);
  };
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0].replace(TRAILING_PUNCTUATION, '');
    const href = safeHref(raw);
    push({ kind: 'text', text: text.slice(cursor, match.index) });
    cursor = match.index + match[0].length;
    if (href) {
      push({ kind: 'link', text: raw, href });
      push({ kind: 'text', text: match[0].slice(raw.length) });
    } else {
      push({ kind: 'text', text: match[0] });
    }
  }
  push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}
