import type { Row } from './data';
import { esc } from './format';
import { icons } from './icons';
import { avatars, empty, platformIcon, rowLength, rowWhen, searchBar, visibleRows } from './rows';
import type { Grouping, State } from './state';

const views: [Grouping, string][] = [
  ['date', 'By date'],
  ['company', 'By company'],
  ['person', 'By person'],
  ['folders', 'My folders'],
];

const groupNames: Record<Grouping, (row: Row, people: string[]) => string[]> = {
  company: (row) => [row.company],
  folders: (row) => [row.folder],
  person: (row, people) => row.people.map((index) => people[index] ?? ''),
  date: (row) => [row.hoursAgo < 24 * 7 ? 'Last 7 days' : 'Earlier'],
};

function minute(row: Row, people: string[]): string {
  const title = esc(row.title);
  return `<li class="minute"><a class="minute-main" href="#" data-act="open" data-id="${row.id}"><span class="minute-title">${platformIcon(row.platform)}<span class="truncate">${title}</span></span><span class="minute-meta"><span>${rowWhen(row)}</span><span class="mono">${icons.clock}${rowLength(row)}</span><span class="company-chip">${icons.building}<span class="truncate">${esc(row.company)}</span></span></span><span class="minute-snippet">${esc(row.snippet)}</span></a><div class="minute-side">${avatars(row.people, people)}</div></li>`;
}

function group(name: string, items: Row[], state: State, icon: string): string {
  const open = !state.collapsed.includes(name);
  return `<section class="group"><header class="group-head"><button type="button" class="group-toggle" data-act="group" data-name="${esc(name)}" aria-expanded="${open}"><span class="group-chevron${open ? ' is-open' : ''}">${icons.chevron}</span>${icon}<span class="group-title truncate">${esc(name)}</span><span class="count">${items.length}</span></button></header>${open ? `<ul class="panel list minutes">${items.map((row) => minute(row, state.names)).join('')}</ul>` : ''}</section>`;
}

export function libraryScreen(state: State): string {
  const shown = visibleRows(state).filter((row) => row.status === 'transcribed');
  const members = (name: string) =>
    shown.filter((row) => groupNames[state.grouping](row, state.names).includes(name));
  const names = [
    ...new Set(shown.flatMap((row) => groupNames[state.grouping](row, state.names))),
  ].sort((a, b) => members(b).length - members(a).length);
  const groups = names.map((name) =>
    group(
      name,
      members(name),
      state,
      state.grouping === 'person'
        ? icons.users
        : state.grouping === 'folders'
          ? icons.folder
          : icons.building,
    ),
  );
  const switcher = views
    .map(
      ([key, label]) =>
        `<a href="#" data-act="grouping" data-key="${key}"${state.grouping === key ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');
  return `<header class="page-head"><div><h1 role="heading" aria-level="2">Minutes</h1><p class="lede">Every meeting with a transcript, sorted the way you look for it.</p></div></header><div class="minutes-controls"><nav class="segmented view-switch" aria-label="Sort minutes">${switcher}</nav></div><div class="toolbar minutes-toolbar">${searchBar(state, 'Search minutes', 'Search titles, companies, people and transcripts')}</div><p class="minutes-count muted">${shown.length} minutes</p>${groups.length ? `<div class="groups">${groups.join('')}</div>` : empty('minutes')}`;
}
