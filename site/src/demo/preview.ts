import { at, esc, fullDate } from './format';
import { speakersOf, talkOf } from './fakes';
import { markdown } from './markdown';
import { platformName } from './rows';
import { currentRow, doc, type PreviewTab, type State } from './state';

const link = (id: string) => `https://openminutes.example/s/${id}`;
const stamp = (seconds: number) =>
  [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), Math.floor(seconds % 60)]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');

const section = (title: string, body: string) => `<section><h2>${title}</h2>${body}</section>`;

function panel(tab: PreviewTab, state: State): string {
  const talk = talkOf(state.meetingId);
  const { lines, chat } = talk;
  const people = state.names;
  if (tab === 'transcript') {
    const rows = lines
      .map(
        (line) =>
          `<p class="pv-seg"><time>${stamp(line.start)}</time><span><span class="pv-who">${esc(people[line.speaker] ?? '')}:</span> ${esc(line.text)}</span></p>`,
      )
      .join('');
    return section('Transcript', rows);
  }
  if (tab === 'chat') {
    const bubbles = chat
      .map(
        (message) =>
          `<div class="pv-bubble"><p class="pv-meta"><span class="pv-who">${esc(people[message.who] ?? '')}</span> <time>${stamp(message.at)}</time></p><p class="pv-body">${esc(message.text)} <u>${esc(message.href)}</u></p></div>`,
      )
      .join('');
    return section('Chat', bubbles);
  }
  if (tab === 'links') {
    const shared = chat
      .map((message) => `<li>${esc(people[message.who] ?? '')}: <u>${esc(message.href)}</u></li>`)
      .join('');
    const own = state.link
      ? `<h3>Share link / documents</h3><ul><li>Shareable link: <u>${link(state.meetingId)}</u></li></ul>`
      : '';
    return section('Links', `${own}<h3>Shared in the meeting chat</h3><ul>${shared}</ul>`);
  }
  const attendees = speakersOf(talk)
    .map((speaker) => `<li>${esc(people[speaker] ?? '')}</li>`)
    .sort()
    .join('');
  const { versions, active } = doc(state);
  const summary = markdown((versions[active]?.markdown ?? '').replace(/^## Summary\s*/, ''));
  return `<section class="pv-people"><h2>Attendees</h2><ul>${attendees}</ul></section><section class="pv-summary"><h2>Summary</h2>${summary}</section>`;
}

export function preview(state: State, tab: PreviewTab): string {
  const row = currentRow(state);
  const tabs: [PreviewTab, string, boolean][] = [
    ['minutes', 'Minutes', true],
    ['transcript', 'Transcript', state.include.transcript],
    ['chat', 'Chat', state.include.chat],
    ['links', 'Links', state.include.links],
  ];
  const bar = tabs
    .filter(([, , shown]) => shown)
    .map(
      ([key, label]) =>
        `<button type="button" role="tab" data-act="preview-tab" data-tab="${key}" aria-selected="${key === tab}">${label}</button>`,
    )
    .join('');
  return `<div class="pv-overlay" role="dialog" aria-modal="true" aria-label="Preview of the shared page"><div class="pv-bar"><span class="pv-url" aria-hidden="true">${link(row.id)}</span><button type="button" class="link" data-act="preview-close" data-k="preview-close">Close preview</button></div><div class="pv"><header><h1 role="heading" aria-level="2">${esc(row.title)}</h1><dl class="pv-facts"><div><dt>Date</dt><dd>${fullDate(at(-row.hoursAgo)).replace(/, [\d:]+ [AP]M$/, '')}</dd></div><div><dt>Meeting</dt><dd>${platformName[row.platform]}</dd></div></dl></header><div class="pv-tabs" role="tablist" aria-label="Shared page">${bar}</div>${panel(tab, state)}<p class="pv-powered">Powered by OpenMinutes</p></div></div>`;
}
