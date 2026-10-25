import { at, clockTime, duration, esc, fullDate, length } from './format';
import { icons } from './icons';
import { speakersOf, talkOf, type Talk } from './fakes';
import { minutesCard } from './minutes-card';
import { pill, platformIcon, platformName } from './rows';
import { currentRow, type State } from './state';
import { summaryPanel } from './summary';

export const activeLine = (state: State) =>
  talkOf(state.meetingId).lines.findLastIndex((line) => line.start <= state.time);

function talkTimes(talk: Talk) {
  return speakersOf(talk).map((speaker) => ({
    speaker,
    seconds: talk.lines
      .filter((line) => line.speaker === speaker)
      .reduce((sum, line) => sum + line.end - line.start, 0),
  }));
}

const mark = (index: number, state: State) =>
  `<li data-speaker-slot="${index}"><button type="button" data-act="speaker" data-i="${index}" aria-pressed="${state.speaker === index}">${esc(state.names[index] ?? '')}</button></li>`;

function timeline(state: State, talk: Talk): string {
  const lanes = speakersOf(talk);
  const bars = talk.lines
    .map((line) => {
      const dim = state.speaker !== null && state.speaker !== line.speaker ? ' class="dim"' : '';
      return `<i${dim} data-speaker-slot="${line.speaker}" style="background: var(--spk); left: ${(line.start / talk.duration) * 100}%; width: ${Math.max(((line.end - line.start) / talk.duration) * 100, 0.4)}%; top: ${(lanes.indexOf(line.speaker) / lanes.length) * 26 + 2}px; height: ${Math.max(26 / lanes.length - 3, 4)}px;"></i>`;
    })
    .join('');
  return `<div class="player"><button type="button" class="play" data-act="toggle" aria-label="${state.playing ? 'Pause' : 'Play'}">${state.playing ? icons.pause : icons.play}</button><button type="button" class="timeline" data-act="seek-bar" aria-label="Seek"><span class="rule"></span>${bars}<span class="head" style="left: ${(state.time / talk.duration) * 100}%;"></span></button><span class="clock mono">${duration(state.time)} / ${duration(talk.duration)}</span></div>`;
}

function transcript(state: State, talk: Talk): string {
  const current = activeLine(state);
  const wall = at(-currentRow(state).hoursAgo).getTime();
  const entries = [
    ...talk.lines.map((line, index) => ({ ...line, index, kind: 'line' as const })),
    ...(state.showChat && state.speaker === null
      ? talk.chat.map((message) => ({ ...message, start: message.at, kind: 'chat' as const }))
      : []),
  ]
    .filter(
      (entry) => entry.kind === 'chat' || state.speaker === null || entry.speaker === state.speaker,
    )
    .sort((a, b) => a.start - b.start);
  const items = entries
    .map((entry) => {
      const stamp = `<span class="mono muted">${duration(entry.start)}</span>`;
      if (entry.kind === 'chat') {
        return `<li class="chat"><button type="button" data-act="seek" data-t="${entry.start}">${stamp}<span class="bubble"><strong>${esc(state.names[entry.who] ?? '')}</strong><span class="chat-text">${esc(entry.text)} <span class="demo-link">${esc(entry.href)}</span></span><time>${clockTime(new Date(wall + entry.start * 1000))}</time></span></button></li>`;
      }
      return `<li${entry.index === current ? ' class="active"' : ''} data-speaker-slot="${entry.speaker}" data-line="${entry.index}"><button type="button" data-act="seek" data-t="${entry.start}">${stamp}<span><strong>${esc(state.names[entry.speaker] ?? '')}</strong>${esc(entry.text)}</span></button></li>`;
    })
    .join('');
  const hidden = state.tab !== 'transcript' ? ' hidden' : '';
  const chips = speakersOf(talk)
    .map((speaker) => mark(speaker, state))
    .join('');
  return `<ul class="speakers" aria-label="Speakers (select one to filter)"${hidden}>${chips}</ul><ol class="transcript"${hidden}>${items}</ol>`;
}

const card = (title: string, body: string) =>
  `<section class="panel card"><header class="card-head"><div class="card-title"><h3>${title}</h3></div></header><div class="card-body">${body}</div></section>`;

function side(state: State, talk: Talk): string {
  const row = currentRow(state);
  const times = talkTimes(talk);
  const spoken = times.reduce((sum, entry) => sum + entry.seconds, 0);
  const details = `<dl class="facts"><dt>Platform</dt><dd>${platformName[row.platform]}</dd><dt>Link</dt><dd class="mono" title="${esc(row.link)}">${esc(row.link)}</dd><dt>Ended</dt><dd>${fullDate(at(-row.hoursAgo + (row.minutes * 60) / 3600))}</dd></dl>`;
  const crew = times
    .map(
      ({ speaker, seconds }) =>
        `<li><div class="people-name"><strong class="truncate">${esc(state.names[speaker] ?? '')}</strong><button type="button" class="icon-button" aria-label="Rename ${esc(state.names[speaker] ?? '')}" data-act="rename" data-i="${speaker}">${icons.pencil}</button></div><span class="muted people-meta">${length(seconds)} talking</span></li>`,
    )
    .join('');
  const share = times
    .map(
      ({ speaker, seconds }) =>
        `<li data-speaker-slot="${speaker}"><span>${esc(state.names[speaker] ?? '')}</span><span class="mono muted">${Math.round((seconds / spoken) * 100)}%</span><i style="width: ${(seconds / spoken) * 100}%;"></i></li>`,
    )
    .join('');
  return `<aside class="side">${card('Details', details)}${card('People', `<ul class="participant-list">${crew}</ul>`)}${card('Talk time', `<ul class="talk">${share}</ul>`)}${minutesCard(state)}</aside>`;
}

function heading(state: State): string {
  const title = esc(currentRow(state).title);
  if (state.editing === 'title') {
    return `<form class="title-form" data-act="title-save"><input class="title-input" name="title" data-k="title" aria-label="Meeting title" value="${title}" maxlength="120" autocomplete="off"><div class="confirm-actions"><button type="button" data-act="edit-cancel">Cancel</button><button type="submit" class="primary">Save</button></div></form>`;
  }
  return `<h1 role="heading" aria-level="2" class="title-heading"><button type="button" class="title-edit" data-act="edit" data-what="title" aria-label="Edit title: ${title}"><span>${title}</span>${icons.pencil}</button></h1>`;
}

function company(state: State): string {
  const row = currentRow(state);
  if (state.editing !== 'company') {
    return `<p class="company-line">${icons.building}<strong>${esc(row.company)}</strong><span class="muted">from the calendar</span><button type="button" class="link" data-act="edit" data-what="company">Change</button></p>`;
  }
  const names = [...new Set(state.rows.map((entry) => entry.company))];
  const picks = names
    .filter((name) => name !== row.company)
    .map(
      (name) =>
        `<button type="button" class="chip-button" data-act="company-pick" data-name="${esc(name)}">${esc(name)}</button>`,
    )
    .join('');
  return `<section class="company-ask" aria-labelledby="company-ask-title"><h3 id="company-ask-title">Change the company</h3><form class="company-form" data-act="company-save"><label class="field"><span>Company</span><input name="company" data-k="company" value="${esc(row.company)}" maxlength="80" placeholder="Company name" autocomplete="off"></label><div class="suggestions" role="group" aria-label="Earlier companies">${picks}</div><div class="confirm-actions"><button type="button" data-act="edit-cancel">Cancel</button><button type="submit" class="primary">Save</button></div></form></section>`;
}

export function meetingScreen(state: State): string {
  const row = currentRow(state);
  const talk = talkOf(row.id);
  const tabs = (['transcript', 'summary'] as const)
    .map(
      (name) =>
        `<button type="button" role="tab" data-act="tab" data-key="${name}" aria-selected="${state.tab === name}"${state.tab === name ? '' : ' tabindex="-1"'}>${name === 'transcript' ? 'Transcript' : 'Summary'}</button>`,
    )
    .join('');
  const chatToggle =
    state.tab === 'transcript' && talk.chat.length
      ? `<label class="chat-toggle"><input type="checkbox" data-act="show-chat"${state.showChat ? ' checked' : ''}>Show chat</label>`
      : '';
  const meta = `<p class="meta">${pill(row.status)}<span>${platformIcon(row.platform)}${platformName[row.platform]}</span><span>${fullDate(at(-row.hoursAgo))}</span><span class="mono">${icons.clock}${duration(row.minutes * 60)}</span></p>`;
  return `<div class="detail"><section><a class="back" href="#" data-act="go" data-to="meetings">${icons.chevron}All meetings</a><div class="detail-head">${heading(state)}${meta}</div>${company(state)}<p class="voices-open"><button type="button" data-act="speakers">Edit speakers</button></p><div class="tabs" role="tablist" aria-label="Meeting">${tabs}</div>${chatToggle}${timeline(state, talk)}${transcript(state, talk)}${state.tab === 'summary' ? summaryPanel(state) : ''}</section>${side(state, talk)}</div>`;
}
