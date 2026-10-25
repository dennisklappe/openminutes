import { FORMATS } from './export';
import { talkOf } from './fakes';
import { icons } from './icons';
import type { Include, State } from './state';

export const partsLabel = (parts: Include) =>
  [
    'Minutes',
    ...(parts.transcript ? ['transcript'] : []),
    ...(parts.chat ? ['chat'] : []),
    ...(parts.links ? ['links'] : []),
  ].join(' + ');

const same = (a: Include, b: Include) =>
  a.transcript === b.transcript && a.chat === b.chat && a.links === b.links;

const box = (key: keyof Include, label: string, state: State) =>
  `<label class="check"><input type="checkbox" data-act="include" data-key="${key}"${state.include[key] ? ' checked' : ''}>${label}</label>`;

function destination(state: State): string {
  if (!state.link) {
    return `<li class="destination"><span class="destination-icon">${icons.link}</span><button type="button" data-act="create-link" title="A private link anyone with the URL can read. It always shows the latest edits.">Create Shareable link</button></li>`;
  }
  const outdated = !same(state.link, state.include);
  return `<li class="destination exists"><span class="destination-icon">${icons.link}</span><div class="destination-main"><a href="#" data-act="preview" data-tab="minutes">Shareable link${icons.external}</a><span class="muted">${partsLabel(state.link)}. Updated just now</span></div><div class="destination-actions">${outdated ? '<button type="button" data-act="apply-include">Apply include</button>' : ''}<div class="menu"><button type="button" aria-label="More for Shareable link" data-act="menu" data-key="link">${icons.more}</button>${state.menu === 'link' ? '<div class="menu-list end" role="menu"><button type="button" role="menuitem" data-act="revoke">Revoke link</button></div>' : ''}</div></div></li>`;
}

function downloadMenu(state: State): string {
  const open = state.menu === 'download';
  const offered = FORMATS.filter(([format]) => format !== 'audio' || talkOf(state.meetingId).src);
  const items = offered
    .map(
      ([format, label]) =>
        `<button type="button" role="menuitem" data-act="download" data-format="${format}">${label}</button>`,
    )
    .join('');
  return `<div class="menu"><button type="button" aria-haspopup="menu" aria-expanded="${open}" data-act="menu" data-key="download">${icons.download} Download</button>${open ? `<div class="menu-list start" role="menu">${items}</div>` : ''}</div>`;
}

const googleDoc = `<li class="destination"><span class="destination-icon">${icons.minutes}</span><button type="button" data-act="google-doc" title="Creates a Google Doc with the minutes. In the demo it saves the Word file instead.">Create Google Doc</button></li>`;

export function minutesCard(state: State): string {
  return `<section class="panel card"><header class="card-head"><div class="card-title"><h3>Minutes</h3></div></header><div class="card-body"><fieldset class="include"><legend>Include</legend><label class="check"><input type="checkbox" checked disabled>Minutes</label>${box('transcript', 'Transcript', state)}${box('chat', 'Chat', state)}${box('links', 'Links', state)}</fieldset><div class="minutes-actions"><button type="button" class="primary" data-act="share">Share</button>${downloadMenu(state)}<a class="minutes-preview-link" href="#" data-act="preview" data-tab="minutes">Preview</a></div><ul class="destinations">${destination(state)}${googleDoc}</ul></div></section>`;
}
