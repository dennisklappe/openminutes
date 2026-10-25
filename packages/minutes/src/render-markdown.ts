import { chatParts, showsChat } from './chat.js';
import {
  CHAT_LINKS_TITLE,
  CHAT_TITLE,
  SUMMARY_LINKS_TITLE,
  DOCUMENT_LINKS_TITLE,
  LINKS_TITLE,
  linkGroups,
} from './links.js';
import { formatDate, formatOffset, formatTimeRange, platformName } from './format.js';
import { POWERED_BY } from './footer.js';
import { resolveLook } from './look.js';
import type { RenderOptions } from './options.js';
import { splitActions } from './summary-split.js';
import { personLabel } from './people.js';
import type { Minutes, MinutesPerson } from './types.js';

const person = (p: MinutesPerson, note = '') => `- ${personLabel(p)}${note}`;

const heading = (title: string) => (title ? [`## ${title}`, ''] : []);

function transcriptLines(minutes: Minutes): string[] {
  return minutes.transcript.flatMap((segment) => {
    const speaker = segment.speaker ? `${segment.speaker}: ` : '';
    return [`**${formatOffset(segment.startMs)}** ${speaker}${segment.text}`, ''];
  });
}

function chatLines(minutes: Minutes): string[] {
  return minutes.chat.flatMap((message) => {
    const body = chatParts(message)
      .map((part) => part.text)
      .join('');
    return [`**${formatOffset(message.offsetMs)}** ${message.sender}: ${body}`, ''];
  });
}

export function renderMinutesMarkdown(
  minutes: Minutes,
  options: Pick<RenderOptions, 'includeTranscript' | 'includeChat' | 'timeZone'> &
    Partial<Pick<RenderOptions, 'template' | 'custom' | 'linksTab' | 'links'>>,
): string {
  const look = resolveLook({ ...options, template: options.template ?? 'classic' });
  const { labels, format } = look;
  const { summary, actions } = look.custom
    ? splitActions(minutes.summary ?? '')
    : { summary: minutes.summary ?? '', actions: '' };
  const lines: string[] = [];
  if (look.organisation) lines.push(`*${look.organisation}*`, '');
  lines.push(`# ${minutes.title}`, '');
  const extra = (value: string) => (value ? [value.replace(/\n+/g, '\n\n'), ''] : []);
  lines.push(...extra(look.extraBefore));
  for (const { id, title } of look.sections) {
    if (id === 'details') {
      lines.push(...heading(title));
      if (minutes.startedAt) {
        lines.push(`**${labels.date}:** ${formatDate(minutes.startedAt, format)}`, '');
        lines.push(
          `**${labels.time}:** ${formatTimeRange(minutes.startedAt, minutes.endedAt, format)}`,
          '',
        );
      }
      if (minutes.location) lines.push(`**${labels.location}:** ${minutes.location}`, '');
      if (minutes.joinUrl) {
        lines.push(
          `**${labels.meeting}:** [${platformName(minutes.platform)}](${minutes.joinUrl})`,
          '',
        );
      }
    } else if (id === 'attendees' && minutes.attendees.length > 0) {
      lines.push(...heading(title), ...minutes.attendees.map((p) => person(p)), '');
    } else if (id === 'absent' && minutes.absent.length > 0) {
      lines.push(
        ...heading(title),
        ...minutes.absent.map((p) => person(p, p.declined ? ' (declined)' : '')),
        '',
      );
    } else if (id === 'summary') {
      lines.push(...heading(title), summary || '_No summary has been generated yet._', '');
    } else if (id === 'actions' && actions) {
      lines.push(...heading(title), actions, '');
    }
  }
  lines.push(...extra(look.extraAfter));
  const transcriptTitle = look.sections.find((section) => section.id === 'transcript')?.title;
  if (options.includeTranscript && transcriptTitle !== undefined) {
    lines.push('---', '', ...heading(transcriptTitle || 'Transcript'), ...transcriptLines(minutes));
  }
  if (showsChat(minutes, options))
    lines.push('---', '', `## ${CHAT_TITLE}`, '', ...chatLines(minutes));
  const groups = linkGroups(minutes, { ...options, template: look.template });
  if (groups) {
    lines.push('---', '', `## ${LINKS_TITLE}`, '');
    if (groups.documents.length > 0) {
      lines.push(`### ${DOCUMENT_LINKS_TITLE}`, '');
      lines.push(...groups.documents.map((entry) => `- ${entry.label}: ${entry.url}`), '');
    }
    if (groups.summary.length > 0) {
      lines.push(`### ${SUMMARY_LINKS_TITLE}`, '');
      lines.push(...groups.summary.map((url) => `- ${url}`), '');
    }
    if (groups.chat.length > 0) {
      lines.push(`### ${CHAT_LINKS_TITLE}`, '');
      lines.push(...groups.chat.map((entry) => `- ${entry.sender}: ${entry.url}`), '');
    }
  }
  lines.push(
    '---',
    '',
    POWERED_BY.text.replace(POWERED_BY.label, `[${POWERED_BY.label}](${POWERED_BY.url})`),
    '',
  );
  return lines.join('\n');
}
