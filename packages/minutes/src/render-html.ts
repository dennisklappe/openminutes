import { chatParts, showsChat } from './chat.js';
import { defaultSectionTitles } from './custom-template.js';
import { escapeHtml } from './html.js';
import { formatDate, formatOffset, formatTimeRange, platformName } from './format.js';
import { POWERED_BY } from './footer.js';
import {
  CHAT_LINKS_TITLE,
  CHAT_TITLE,
  SUMMARY_LINKS_TITLE,
  DOCUMENT_LINKS_TITLE,
  LINKS_TITLE,
  linkGroups,
  type LinkGroups,
} from './links.js';
import { resolveLook, type Look } from './look.js';
import { logoDataUri } from './logo.js';
import { markdownToHtml } from './markdown.js';
import type { RenderOptions } from './options.js';
import { splitActions } from './summary-split.js';
import { BASE_CSS, findTemplate } from './templates/index.js';
import { customCss } from './templates/custom.js';
import { personLabel } from './people.js';
import type { Minutes, MinutesPerson } from './types.js';

const fact = (label: string, value: string) =>
  `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;

const link = (url: string, text: string, newTab = false) =>
  `<a href="${escapeHtml(url)}"${newTab ? ' target="_blank"' : ''} rel="noopener noreferrer">${escapeHtml(text)}</a>`;

const heading = (title: string) => (title ? `<h2>${escapeHtml(title)}</h2>` : '');

function personHtml(person: MinutesPerson, note = ''): string {
  return `<li>${escapeHtml(personLabel(person))}${note}</li>`;
}

function factsHtml(minutes: Minutes, look: Look): string {
  const { labels, format } = look;
  const rows: string[] = [];
  if (minutes.startedAt) {
    rows.push(fact(labels.date, escapeHtml(formatDate(minutes.startedAt, format))));
    rows.push(
      fact(labels.time, escapeHtml(formatTimeRange(minutes.startedAt, minutes.endedAt, format))),
    );
  }
  if (minutes.location) rows.push(fact(labels.location, escapeHtml(minutes.location)));
  if (minutes.joinUrl) {
    rows.push(fact(labels.meeting, link(minutes.joinUrl, platformName(minutes.platform))));
  }
  return `<dl class="facts">${rows.join('')}</dl>`;
}

const peopleSection = (title: string, people: string[], className: string) =>
  people.length === 0
    ? ''
    : `<section class="people ${className}">${heading(title)}<ul>${people.join('')}</ul></section>`;

const summarySection = (title: string, markdown: string, className: string, empty: string) =>
  `<section class="${className}">${heading(title)}${
    markdown ? markdownToHtml(markdown) : `<p class="empty">${empty}</p>`
  }</section>`;

function transcriptSection(minutes: Minutes, title: string): string {
  const segments = minutes.transcript.map(
    (segment) =>
      `<p class="seg"><time>${formatOffset(segment.startMs)}</time><span>${
        segment.speaker ? `<span class="who">${escapeHtml(segment.speaker)}:</span> ` : ''
      }${escapeHtml(segment.text)}</span></p>`,
  );
  const body = segments.length > 0 ? segments.join('') : '<p class="empty">No transcript.</p>';
  return `<section class="transcript">${heading(title)}${body}</section>`;
}

function chatSection(minutes: Minutes): string {
  const messages = minutes.chat.map((message) => {
    const body = chatParts(message)
      .map((part) => (part.href ? link(part.href, part.text, true) : escapeHtml(part.text)))
      .join('');
    return `<div class="bubble"><p class="meta"><span class="who">${escapeHtml(message.sender)}</span> <time>${formatOffset(message.offsetMs)}</time></p><p class="body">${body}</p></div>`;
  });
  return `<section class="chat"><h2>${CHAT_TITLE}</h2>${messages.join('')}</section>`;
}

function linksSection(groups: LinkGroups): string {
  const list = (items: string[]) => `<ul>${items.join('')}</ul>`;
  const item = (label: string, url: string) =>
    `<li>${escapeHtml(label)}: ${link(url, url, true)}</li>`;
  return `<section class="links"><h2>${LINKS_TITLE}</h2>${
    groups.documents.length > 0
      ? `<h3>${DOCUMENT_LINKS_TITLE}</h3>${list(groups.documents.map((e) => item(e.label, e.url)))}`
      : ''
  }${
    groups.summary.length > 0
      ? `<h3>${SUMMARY_LINKS_TITLE}</h3>${list(groups.summary.map((url) => `<li>${link(url, url, true)}</li>`))}`
      : ''
  }${
    groups.chat.length > 0
      ? `<h3>${CHAT_LINKS_TITLE}</h3>${list(groups.chat.map((e) => item(e.sender, e.url)))}`
      : ''
  }</section>`;
}

interface Tab {
  id: string;
  title: string;
  html: string;
}

function tabbed(tabs: Tab[]): string {
  const radios = tabs
    .map(
      (tab, index) =>
        `<input class="tab-radio" type="radio" name="tab" id="tab-${tab.id}"${index === 0 ? ' checked' : ''}>`,
    )
    .join('');
  const bar = tabs
    .map((tab) => `<label for="tab-${tab.id}">${escapeHtml(tab.title)}</label>`)
    .join('');
  const panels = tabs
    .map((tab) => `<div class="tab-panel" id="${tab.id}">${tab.html}</div>`)
    .join('');
  return `<div class="tabs">${radios}<div class="tab-bar">${bar}</div>${panels}</div>`;
}

const extraHtml = (value: string) =>
  value
    ? `<div class="extra">${value
        .split(/\n+/)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}</div>`
    : '';

export function renderMinutesHtml(minutes: Minutes, options: RenderOptions): string {
  const look = resolveLook(options);
  const css = look.custom ? customCss(look) : findTemplate(options.template).css;
  const logo =
    options.logo && look.logo !== 'none'
      ? `<img class="logo" src="${logoDataUri(options.logo)}" alt="Logo">`
      : '';
  const first = look.sections.find((section) => section.id !== 'transcript');
  const leadFacts = first?.id === 'details' && first.title === '';
  const { summary, actions } = look.custom
    ? splitActions(minutes.summary ?? '')
    : { summary: minutes.summary ?? '', actions: '' };
  const render = ({ id, title }: Look['sections'][number]) => {
    switch (id) {
      case 'details':
        return leadFacts
          ? ''
          : `<section class="details">${heading(title)}${factsHtml(minutes, look)}</section>`;
      case 'attendees':
        return peopleSection(
          title,
          minutes.attendees.map((person) => personHtml(person)),
          'attendees',
        );
      case 'absent':
        return peopleSection(
          title,
          minutes.absent.map((person) =>
            personHtml(person, person.declined ? ' <span class="note">declined</span>' : ''),
          ),
          'absent',
        );
      case 'summary':
        return summarySection(
          title,
          summary,
          'summary',
          'No summary has been generated for this meeting yet.',
        );
      case 'actions':
        return actions ? summarySection(title, actions, 'summary actions', '') : '';
      case 'transcript':
        return '';
    }
  };
  const joined = (parts: string[]) => parts.filter((part) => part !== '').join('\n');
  const minutesHtml = joined([
    extraHtml(look.extraBefore),
    ...look.sections.map(render),
    extraHtml(look.extraAfter),
  ]);
  const transcriptTitle = look.sections.find((section) => section.id === 'transcript')?.title;
  const groups = linkGroups(minutes, options);
  const tabs: Tab[] = [{ id: 'minutes', title: 'Minutes', html: minutesHtml }];
  if (options.includeTranscript && transcriptTitle !== undefined) {
    tabs.push({
      id: 'transcript',
      title: transcriptTitle || defaultSectionTitles.transcript,
      html: transcriptSection(minutes, transcriptTitle),
    });
  }
  if (showsChat(minutes, options))
    tabs.push({ id: 'chat', title: CHAT_TITLE, html: chatSection(minutes) });
  if (groups) tabs.push({ id: 'links', title: LINKS_TITLE, html: linksSection(groups) });
  const content = tabs.length > 1 ? tabbed(tabs) : minutesHtml;
  const organisation = look.organisation
    ? `<p class="org">${escapeHtml(look.organisation)}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(minutes.title)}</title>
<style>${BASE_CSS}${css}</style>
</head>
<body class="tpl-${look.template}">
<main class="minutes">
<header>${logo}<div>${organisation}<h1>${escapeHtml(minutes.title)}</h1>${leadFacts ? factsHtml(minutes, look) : ''}</div></header>
${content}
<footer class="powered">${POWERED_BY.text.replace(POWERED_BY.label, link(POWERED_BY.url, POWERED_BY.label, true))}</footer>
</main>
</body>
</html>
`;
}
