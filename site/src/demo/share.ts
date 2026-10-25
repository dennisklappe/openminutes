import { partsLabel } from './minutes-card';
import type { State } from './state';

const recipients = [
  ['Jonas Weber', 'jonas@partner.example', true],
  ['Priya Nair', 'priya@northwind.example', false],
  ['Tom Becker', 'tom@northwind.example', true],
] as const;

export function shareDialog(state: State): string {
  if (state.dialog === 'sent') {
    return `<dialog class="share-dialog" aria-labelledby="share-title"><header><h2 id="share-title">Share with attendees</h2></header><p>Nothing was sent. This is a demo, so no email goes anywhere. In OpenMinutes each person gets their own mail with a link to the minutes.</p><div class="actions"><button type="button" class="primary" data-act="dialog-close">Done</button></div></dialog>`;
  }
  const who = recipients
    .map(
      ([name, email, checked]) =>
        `<label class="check"><input type="checkbox" data-act="who"${checked ? ' checked' : ''}><span>${name} <span class="muted">${email}</span></span></label>`,
    )
    .join('');
  return `<dialog class="share-dialog" aria-labelledby="share-title"><header><h2 id="share-title">Share with attendees</h2><button type="button" class="link" data-act="dialog-close">Close</button></header><div class="share-form"><fieldset><legend>Who</legend>${who}</fieldset><fieldset><legend>What</legend><label class="field"><span>Share as</span><select><option>Shareable link (will be created)</option></select><small>${partsLabel(state.include)}. It is created when you press Share. Change this under Include on the Minutes card.</small></label></fieldset><p class="share-confirm" role="status" data-k="who-count">Will email 2 people</p><div class="actions"><button type="button" class="primary" data-act="send" data-k="send">Share with 2 people</button><button type="button" data-act="dialog-close">Cancel</button></div></div></dialog>`;
}
