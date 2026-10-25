import type { ChatMessageDto, MeetingDto, SegmentDto, SummaryDto } from '../dto.js';

type ExportSegment = Pick<SegmentDto, 'startMs' | 'endMs' | 'text' | 'speaker'>;

function timestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

type Entry =
  { kind: 'segment'; segment: ExportSegment } | { kind: 'chat'; message: ChatMessageDto };

function interleave(segments: ExportSegment[], chat: ChatMessageDto[]): Entry[] {
  const entries: Entry[] = [
    ...segments.map((segment) => ({ kind: 'segment' as const, segment })),
    ...chat.map((message) => ({ kind: 'chat' as const, message })),
  ];
  const at = (entry: Entry) =>
    entry.kind === 'chat' ? entry.message.offsetMs : entry.segment.startMs;
  return entries.sort((a, b) => at(a) - at(b));
}

export function transcriptMarkdown(
  meeting: MeetingDto,
  segments: ExportSegment[],
  chat: ChatMessageDto[],
  summary?: SummaryDto,
): string {
  const lines = [`# ${meeting.title}`, ''];
  if (meeting.startedAt) lines.push(`Started: ${meeting.startedAt}`, '');
  if (summary) lines.push(summary.content, '');
  lines.push('## Transcript', '');
  for (const entry of interleave(segments, chat))
    lines.push(
      entry.kind === 'chat'
        ? `**${timestamp(entry.message.offsetMs)}** _Chat, ${entry.message.sender}:_ ${entry.message.text}`
        : `**${timestamp(entry.segment.startMs)}** ${entry.segment.speaker ? `${entry.segment.speaker}: ` : ''}${entry.segment.text}`,
      '',
    );
  return lines.join('\n');
}

export function transcriptJson(
  meeting: MeetingDto,
  segments: ExportSegment[],
  chat: ChatMessageDto[],
  summaries: SummaryDto[],
) {
  return {
    title: meeting.title,
    platform: meeting.platform,
    joinUrl: meeting.joinUrl,
    startedAt: meeting.startedAt,
    endedAt: meeting.endedAt,
    summaries: summaries.map(
      ({ provider, model, promptName, createdAt, content, version, author, active }) => ({
        version,
        active,
        author,
        provider,
        model,
        prompt: promptName,
        createdAt,
        content,
      }),
    ),
    segments: segments.map(({ startMs, endMs, text, speaker }) => ({
      startMs,
      endMs,
      speaker,
      text,
    })),
    chat: chat.map(({ sender, text, links, sentAt, offsetMs }) => ({
      sender,
      text,
      links,
      sentAt,
      offsetMs,
    })),
  };
}

export function downloadName(title: string, extension: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'meeting'}.${extension}`;
}
