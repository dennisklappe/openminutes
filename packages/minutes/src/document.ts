import { chatParts, showsChat } from './chat.js';
import { defaultSectionTitles } from './custom-template.js';
import { formatDate, formatOffset, formatTimeRange, platformName } from './format.js';
import { POWERED_BY } from './footer.js';
import { resolveLook, type Look } from './look.js';
import {
  CHAT_LINKS_TITLE,
  CHAT_TITLE,
  SUMMARY_LINKS_TITLE,
  DOCUMENT_LINKS_TITLE,
  LINKS_TITLE,
  linkGroups,
  type LinkGroups,
} from './links.js';
import { parseMarkdown, type Inline } from './markdown.js';
import type { RenderOptions } from './options.js';
import { splitActions } from './summary-split.js';
import { personLabel } from './people.js';
import type { Minutes, MinutesPerson } from './types.js';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  muted?: boolean;
  href?: string;
}

export type DocBlock =
  | { type: 'title'; runs: Run[]; center: boolean; header: true }
  | { type: 'heading'; level: 2 | 3 | 4; runs: Run[] }
  | { type: 'paragraph'; runs: Run[]; center?: boolean; header?: boolean }
  | { type: 'item'; ordered: boolean; runs: Run[] }
  | { type: 'table'; header: Run[][]; rows: Run[][][] }
  | { type: 'footer'; runs: Run[] };

interface MinutesDocument {
  main: DocBlock[];
  transcript: DocBlock[] | null;
  chat: DocBlock[] | null;
  links: DocBlock[] | null;
}

const text = (value: string, extra: Omit<Run, 'text'> = {}): Run => ({ text: value, ...extra });
const CHECKBOX = /^\[([ xX])\]\s+/;

function inlineRun(inline: Inline): Run {
  switch (inline.type) {
    case 'text':
      return text(inline.text);
    case 'strong':
      return text(inline.text, { bold: true });
    case 'em':
      return text(inline.text, { italic: true });
    case 'code':
      return text(inline.text, { code: true });
    case 'link':
      return text(inline.text, { href: inline.href });
  }
}

function itemRuns(item: Inline[]): Run[] {
  const runs = item.map(inlineRun);
  const first = runs[0];
  const box = first ? CHECKBOX.exec(first.text) : null;
  if (!first || !box) return runs;
  return [
    text(`${box[1] === ' ' ? '☐' : '☑'} `),
    { ...first, text: first.text.slice(box[0].length) },
    ...runs.slice(1),
  ];
}

function markdownBlocks(markdown: string): DocBlock[] {
  return parseMarkdown(markdown).flatMap((block): DocBlock[] => {
    if (block.type === 'heading') {
      const level = Math.min(4, Math.max(3, block.level + 1)) as 3 | 4;
      return [{ type: 'heading', level, runs: block.inline.map(inlineRun) }];
    }
    if (block.type === 'paragraph')
      return [{ type: 'paragraph', runs: block.inline.map(inlineRun) }];
    if (block.type === 'table') {
      return [
        {
          type: 'table',
          header: block.header.map((cell) => cell.map(inlineRun)),
          rows: block.rows.map((row) => row.map((cell) => cell.map(inlineRun))),
        },
      ];
    }
    return block.items.map((item) => ({
      type: 'item',
      ordered: block.ordered,
      runs: itemRuns(item),
    }));
  });
}

const placeholder = (message: string): DocBlock => ({
  type: 'paragraph',
  runs: [text(message, { italic: true, muted: true })],
});

const heading = (title: string): DocBlock[] =>
  title ? [{ type: 'heading', level: 2, runs: [text(title)] }] : [];

const paragraphs = (value: string): DocBlock[] =>
  value
    .split(/\n+/)
    .filter((line) => line !== '')
    .map((line) => ({ type: 'paragraph', runs: [text(line)] }));

interface Lead {
  center: boolean;
  header: boolean;
}

const fact = (label: string, value: string, lead: Lead, href?: string): DocBlock => ({
  type: 'paragraph',
  ...lead,
  runs: [text(`${label}: `, { bold: true }), text(value, href ? { href } : {})],
});

function detailsBlocks(minutes: Minutes, look: Look, lead: Lead): DocBlock[] {
  const { labels, format } = look;
  const facts: DocBlock[] = [];
  if (minutes.startedAt) {
    facts.push(fact(labels.date, formatDate(minutes.startedAt, format), lead));
    facts.push(
      fact(labels.time, formatTimeRange(minutes.startedAt, minutes.endedAt, format), lead),
    );
  }
  if (minutes.location) facts.push(fact(labels.location, minutes.location, lead));
  if (minutes.joinUrl) {
    facts.push(fact(labels.meeting, platformName(minutes.platform), lead, minutes.joinUrl));
  }
  return facts;
}

function people(list: MinutesPerson[], note: (index: number) => string): DocBlock[] {
  return list.map((person, index): DocBlock => ({
    type: 'item',
    ordered: false,
    runs: [text(personLabel(person)), ...(note(index) ? [text(note(index), { muted: true })] : [])],
  }));
}

const footer = (): DocBlock => ({
  type: 'footer',
  runs: [
    text(POWERED_BY.text.slice(0, POWERED_BY.text.indexOf(POWERED_BY.label)), { muted: true }),
    text(POWERED_BY.label, { href: POWERED_BY.url }),
  ],
});

function chatBlocks(minutes: Minutes): DocBlock[] {
  return [
    ...heading(CHAT_TITLE),
    ...minutes.chat.map((message): DocBlock => ({
      type: 'paragraph',
      runs: [
        text(`${formatOffset(message.offsetMs)}  `, { muted: true }),
        text(`${message.sender}: `, { bold: true }),
        ...chatParts(message).map((part) => text(part.text, part.href ? { href: part.href } : {})),
      ],
    })),
  ];
}

function transcriptBlocks(minutes: Minutes, title: string): DocBlock[] {
  const lines: DocBlock[] = minutes.transcript.map((segment) => ({
    type: 'paragraph',
    runs: [
      text(`${formatOffset(segment.startMs)}  `, { muted: true }),
      ...(segment.speaker ? [text(`${segment.speaker}: `, { bold: true })] : []),
      text(segment.text),
    ],
  }));
  const body = lines.length > 0 ? lines : [placeholder('No transcript.')];
  return [...heading(title || defaultSectionTitles.transcript), ...body];
}

const linkItem = (label: string, url: string): DocBlock => ({
  type: 'item',
  ordered: false,
  runs: [text(`${label}: `), text(url, { href: url })],
});

const subheading = (title: string): DocBlock => ({
  type: 'heading',
  level: 3,
  runs: [text(title)],
});

function linksBlocks(groups: LinkGroups): DocBlock[] {
  return [
    ...heading(LINKS_TITLE),
    ...(groups.documents.length > 0
      ? [
          subheading(DOCUMENT_LINKS_TITLE),
          ...groups.documents.map((entry) => linkItem(entry.label, entry.url)),
        ]
      : []),
    ...(groups.summary.length > 0
      ? [
          subheading(SUMMARY_LINKS_TITLE),
          ...groups.summary.map((url): DocBlock => ({
            type: 'item',
            ordered: false,
            runs: [text(url, { href: url })],
          })),
        ]
      : []),
    ...(groups.chat.length > 0
      ? [
          subheading(CHAT_LINKS_TITLE),
          ...groups.chat.map((entry) => linkItem(entry.sender, entry.url)),
        ]
      : []),
  ];
}

export function buildDocument(minutes: Minutes, options: RenderOptions): MinutesDocument {
  const look = resolveLook(options);
  const center = look.style.centered;
  const empty = placeholder('No summary has been generated for this meeting yet.');
  const { summary, actions } = look.custom
    ? splitActions(minutes.summary ?? '')
    : { summary: minutes.summary ?? '', actions: '' };
  const first = look.sections.find((section) => section.id !== 'transcript');
  const header: DocBlock[] = [];
  if (look.organisation) {
    header.push({
      type: 'paragraph',
      center,
      header: true,
      runs: [text(look.organisation, { bold: true, muted: true })],
    });
  }
  header.push({ type: 'title', center, header: true, runs: [text(minutes.title)] });
  const body: DocBlock[] = [];
  for (const { id, title } of look.sections) {
    if (id === 'details') {
      const lead = first?.id === 'details' && title === '';
      const facts = detailsBlocks(minutes, look, { header: lead, center: lead && center });
      if (lead) header.push(...facts);
      else body.push(...heading(title), ...facts);
    } else if (id === 'attendees' && minutes.attendees.length > 0) {
      body.push(...heading(title), ...people(minutes.attendees, () => ''));
    } else if (id === 'absent' && minutes.absent.length > 0) {
      body.push(
        ...heading(title),
        ...people(minutes.absent, (index) =>
          minutes.absent[index]?.declined ? ' (declined)' : '',
        ),
      );
    } else if (id === 'summary') {
      body.push(...heading(title), ...(summary ? markdownBlocks(summary) : [empty]));
    } else if (id === 'actions' && actions) {
      body.push(...heading(title), ...markdownBlocks(actions));
    }
  }
  const main = [
    ...header,
    ...paragraphs(look.extraBefore),
    ...body,
    ...paragraphs(look.extraAfter),
    footer(),
  ];
  const transcriptTitle = look.sections.find((section) => section.id === 'transcript')?.title;
  const transcript =
    options.includeTranscript && transcriptTitle !== undefined
      ? [...transcriptBlocks(minutes, transcriptTitle), footer()]
      : null;
  const chat = showsChat(minutes, options) ? [...chatBlocks(minutes), footer()] : null;
  const groups = linkGroups(minutes, options);
  return { main, transcript, chat, links: groups ? [...linksBlocks(groups), footer()] : null };
}

export type TableBlock = Extract<DocBlock, { type: 'table' }>;

/** Relative column widths from the longest cell of each column, as fractions of one. */
export function tableColumnShares(block: TableBlock): number[] {
  const weights = block.header.map((_, column) => {
    const lengths = [block.header, ...block.rows].map((row) =>
      (row[column] ?? []).reduce((sum, run) => sum + run.text.length, 0),
    );
    return Math.min(60, Math.max(14, ...lengths));
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}
