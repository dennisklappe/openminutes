import { at, esc, when } from './format';
import { icons } from './icons';
import { empty, pill, platformIcon, rowLength, rowWhen, searchBar, visibleRows } from './rows';
import type { State } from './state';

function joinChoice(index: number, state: State): string {
  const key = `join:${index}`;
  const open = state.menu === key;
  const choices = open
    ? `<div class="join-menu panel" role="menu" aria-label="Join this meeting"><button type="button" role="menuitemradio" aria-checked="true" data-act="menu-close">Join this meeting</button><button type="button" role="menuitemradio" aria-checked="false" data-act="skip" data-i="${index}">Don't join this meeting</button></div>`
    : '';
  return `<span class="join-choice"><button type="button" class="pill join-choice-trigger" aria-haspopup="menu" aria-expanded="${open}" title="Change whether the bot joins this meeting" data-act="menu" data-key="${key}"><i aria-hidden="true"></i>Auto-join${icons.chevron}</button>${choices}</span>`;
}

function upcomingList(state: State): string {
  const items = state.upcoming
    .map(
      (item, index) =>
        `<li><a href="#" data-act="prefill" data-i="${index}"><span class="when">${icons.clock}${when(at(item.hoursAhead))}</span><span class="name">${icons[item.platform]}<span class="truncate">${esc(item.title)}</span></span></a>${joinChoice(index, state)}</li>`,
    )
    .join('');
  const list = items
    ? `<ul class="panel list">${items}</ul>`
    : '<p class="empty">Nothing else is planned.</p>';
  return `<section class="block" aria-labelledby="upcoming-h"><div class="block-head"><h2 id="upcoming-h">Upcoming</h2><span class="muted">${state.upcoming.length} in the next 7 days</span></div>${list}</section>`;
}

function rowMenu(id: string, title: string, state: State): string {
  const key = `row:${id}`;
  const open = state.menu === key;
  const items = open
    ? `<div class="menu-list end" role="menu"><button type="button" role="menuitem" data-act="row-download" data-id="${id}">Download transcript (Markdown)</button><button type="button" role="menuitem" data-act="archive" data-id="${id}">Archive</button><button type="button" role="menuitem" class="danger" data-act="delete" data-id="${id}">Delete meeting</button></div>`
    : '';
  return `<div class="menu"><button type="button" aria-haspopup="menu" aria-expanded="${open}" aria-label="Actions for ${title}" data-act="menu" data-key="${key}">${icons.more}</button>${items}</div>`;
}

function recentTable(state: State): string {
  const shown = visibleRows(state);
  const body = shown
    .map((row) => {
      const title = esc(row.title);
      const label = `${platformIcon(row.platform)}<span class="cell-title"><span class="truncate">${title}</span></span>`;
      const cell =
        row.status === 'transcribed'
          ? `<a class="row-link" href="#" data-act="open" data-id="${row.id}">${label}</a>`
          : `<span class="row-link">${label}</span>`;
      return `<tr><td><div class="cell-select">${cell}</div></td><td>${pill(row.status)}</td><td class="muted nowrap">${rowWhen(row)}</td><td class="num">${rowLength(row)}</td><td class="num">${row.people.length ? `<span class="people">${icons.users}${row.people.length}</span>` : '-'}</td><td class="row-menu">${rowMenu(row.id, title, state)}</td></tr>`;
    })
    .join('');
  const table = `<div class="panel table-wrap"><table class="table"><thead><tr><th>Meeting</th><th>Status</th><th>Date</th><th class="num">Length</th><th class="num">People</th><th aria-label="Actions"></th></tr></thead><tbody>${body}</tbody></table></div>`;
  return `<section class="block" aria-labelledby="recent-h"><div class="block-head"><h2 id="recent-h">Recent</h2><span class="muted">${shown.length}</span></div><div class="toolbar">${searchBar(state, 'Search meetings', 'Search titles and transcripts')}</div>${shown.length ? table : empty('meetings')}</section>`;
}

export function meetingsScreen(state: State): string {
  return `<header class="page-head"><div><h1 role="heading" aria-level="2">Meetings</h1><p class="lede">Send the bot into a meeting now, or let your calendar do it.</p></div><button type="button" class="button primary record-cta" data-act="go" data-to="record">${icons.record}<span>Record</span></button></header><form class="join" data-act="join"><div class="join-bar">${icons.link}<input required placeholder="Paste a Meet or Teams link" aria-label="Meeting link" type="url" data-k="link"><button class="primary" type="submit">Join<span class="wide"> meeting</span></button></div></form>${upcomingList(state)}${recentTable(state)}`;
}
