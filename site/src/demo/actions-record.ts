import type { Actions, Context } from './context';
import { duration } from './format';
import { addLive } from './live';

const TICK_MS = 200;

export function recordActions(context: Context): Actions {
  const { state } = context;
  const recorder = state.recorder;
  let ticker = 0;

  const paint = () => {
    const level = recorder.paused ? 0 : 0.15 + Math.random() * 0.75;
    context.root
      .querySelector<HTMLElement>('.level-meter')
      ?.style.setProperty('--level', level.toFixed(3));
    const time = context.root.querySelector('.record-time');
    if (time) time.textContent = duration(recorder.elapsed);
  };

  const start = () => {
    Object.assign(recorder, { recording: true, paused: false, elapsed: 0, saved: false });
    ticker = window.setInterval(() => {
      if (!recorder.paused) recorder.elapsed += TICK_MS / 1000;
      paint();
    }, TICK_MS);
    context.render();
    context.focus('[data-act="rec-stop"]');
  };

  return {
    click: {
      'rec-start': () => {
        context.open('consent');
      },
      'rec-consent': () => {
        context.close();
        start();
      },
      'rec-pause': () => {
        recorder.paused = !recorder.paused;
        context.render();
      },
      'rec-stop': () => {
        clearInterval(ticker);
        addLive(context, {
          kind: 'rec',
          title: 'Phone recording',
          platform: 'phone',
          link: 'Recorded on this device',
          minutes: Math.max(1, Math.round(recorder.elapsed / 60)),
          people: [0, 3],
        });
        Object.assign(recorder, { recording: false, paused: false, elapsed: 0, saved: true });
        context.render();
        context.focus('[data-act="rec-start"]');
      },
    },
    submit: {},
  };
}
