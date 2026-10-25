import { esc } from './format';
import { speakersOf, talkOf } from './fakes';
import { people } from './data';
import { shareDialog } from './share';
import type { State } from './state';

const CONSENT = 'Tell everyone present that this conversation is recorded and transcribed.';

const actions = (submit: string) =>
  `<div class="confirm-actions"><button type="button" data-act="dialog-close">Cancel</button><button type="submit" class="primary">${submit}</button></div>`;

function rename(state: State): string {
  const index = state.renaming;
  return `<dialog class="confirm-dialog form-dialog" aria-labelledby="rename-h"><h2 id="rename-h">Rename participant</h2><form data-act="rename-save"><p class="muted">Shown in the transcript, the summary and the minutes. In the meeting this person was <strong>${esc(people[index] ?? '')}</strong>.</p><label class="field"><span>Name</span><input name="name" value="${esc(state.names[index] ?? '')}" maxlength="60" autocomplete="off" autofocus></label>${actions('Save')}</form></dialog>`;
}

function speakers(state: State): string {
  const fields = speakersOf(talkOf(state.meetingId))
    .map(
      (index) =>
        `<label class="field"><span>${esc(people[index] ?? '')}</span><input name="s${index}" value="${esc(state.names[index] ?? '')}" maxlength="60" autocomplete="off"></label>`,
    )
    .join('');
  return `<dialog class="confirm-dialog form-dialog" aria-labelledby="speakers-h"><h2 id="speakers-h">Edit speakers</h2><form data-act="speakers-save"><p class="muted">Name the voices the transcript found. The names change everywhere in this demo.</p>${fields}${actions('Save')}</form></dialog>`;
}

function consent(): string {
  return `<dialog class="consent-dialog" aria-labelledby="consent-h"><h2 id="consent-h">Before you record</h2><p>${CONSENT}</p><div class="actions"><button type="button" class="primary" data-act="rec-consent" autofocus>I understand, start recording</button><button type="button" data-act="dialog-close">Cancel</button></div></dialog>`;
}

export function dialog(state: State): string {
  switch (state.dialog) {
    case 'rename':
      return rename(state);
    case 'speakers':
      return speakers(state);
    case 'consent':
      return consent();
    case 'share':
    case 'sent':
      return shareDialog(state);
    case null:
      return '';
  }
}
