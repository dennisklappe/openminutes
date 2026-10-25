import { duration } from './format';
import type { State } from './state';

const BARS = 24;
const speakerOptions = [
  ['', 'Auto'],
  ['2', '2'],
  ['3', '3'],
  ['4', '4'],
  ['5', '5+'],
];

const meter = Array.from(
  { length: BARS },
  (_, index) => `<i style="--at: ${(index + 1) / BARS};"></i>`,
).join('');

export function recordScreen(state: State): string {
  const { recording, paused, elapsed, speakers, saved } = state.recorder;
  const text = !recording ? 'Ready to record' : paused ? 'Paused' : 'Recording';
  const options = speakerOptions
    .map(
      ([value, label]) =>
        `<option value="${value}"${speakers === value ? ' selected' : ''}>${label}</option>`,
    )
    .join('');
  const controls = recording
    ? `<button type="button" class="record-side" data-act="rec-pause">${paused ? 'Resume' : 'Pause'}</button><button type="button" class="record-button stop" aria-label="Stop recording" data-act="rec-stop"><span></span></button><span class="record-side-spacer"></span>`
    : `<button type="button" class="record-button" aria-label="Start recording" data-act="rec-start"><span></span></button>`;
  const choose = recording
    ? ''
    : `<label class="record-speakers"><span>How many people are talking?</span><select data-act="rec-speakers" aria-label="How many people are talking?">${options}</select></label>`;
  const notice = saved
    ? '<p class="notice">Saved to Meetings. <a href="#" data-act="go" data-to="meetings">Open the meetings list</a></p>'
    : '';
  return `<header class="page-head"><div><h1 role="heading" aria-level="2">Record</h1><p class="lede">Record a conversation with this device. It is transcribed afterwards.</p></div></header><section class="record-stage" aria-label="Recorder"><div class="record-time" role="timer" aria-label="Elapsed time">${duration(elapsed)}</div><p class="record-state" data-phase="${recording && !paused ? 'recording' : 'idle'}">${text}</p><div class="level-meter" role="img" aria-label="Microphone level">${meter}</div>${choose}<div class="record-controls">${controls}</div><div class="record-notices" aria-live="polite">${notice}</div></section>`;
}
