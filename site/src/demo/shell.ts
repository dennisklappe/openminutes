import { esc } from './format';
import { icons } from './icons';
import type { Screen, State } from './state';

const nav: [Screen, string, string][] = [
  ['meetings', 'Meetings', icons.meetings],
  ['library', 'Minutes', icons.minutes],
  ['record', 'Record', icons.record],
  ['settings', 'Settings', icons.settings],
];

const current = (state: State, screen: Screen) =>
  state.screen === screen || (screen === 'meetings' && state.screen === 'meeting');

export function toast(state: State): string {
  if (!state.toast) return '';
  const undo = state.toast.restore
    ? '<button type="button" data-act="toast-undo">Undo</button>'
    : '';
  return `<div class="undo-toast-slot" role="status" aria-live="polite"><div class="undo-toast"><span>${esc(state.toast.text)}</span>${undo}<button type="button" class="toast-close" aria-label="Dismiss" data-act="toast-close">${icons.close}</button></div></div>`;
}

export function shell(state: State, content: string): string {
  const items = nav
    .map(([screen, label, icon]) => {
      const cls = screen === 'record' ? 'nav-item record-link' : 'nav-item';
      return `<button type="button" class="${cls}" data-act="go" data-to="${screen}"${current(state, screen) ? ' aria-current="page"' : ''}>${icon}<span>${label}</span></button>`;
    })
    .join('');
  return `<div class="shell"><aside class="sidebar"><a class="brand" href="#" data-act="go" data-to="meetings">${icons.brand}OpenMinutes</a><nav aria-label="Main">${items}</nav></aside><main class="omd-main">${content}</main></div>`;
}
