import type { Row } from './data';
import type { Context } from './context';
import { talkOf } from './fakes';

const SETTLE_MS = 4000;
let serial = 0;

interface Live {
  kind: 'joined' | 'rec';
  title: string;
  platform: Row['platform'];
  link: string;
  minutes: number;
  people: number[];
}

/** Adds a row that is busy first (the bot joining, a recording being processed) and turns into a transcript row. */
export function addLive(context: Context, live: Live): void {
  const { state } = context;
  const id = `${live.kind}-${++serial}`;
  state.rows.push({
    id,
    title: live.title,
    platform: live.platform,
    status: live.kind === 'joined' ? 'joining' : 'processing',
    hoursAgo: 0,
    minutes: live.kind === 'joined' ? 0 : live.minutes,
    people: [],
    company: 'Internal',
    folder: 'Internal',
    snippet: '',
    link: live.link,
  });
  window.setTimeout(() => {
    const row = state.rows.find((entry) => entry.id === id);
    if (!row) return;
    Object.assign(row, {
      status: 'transcribed',
      minutes: live.minutes,
      people: live.people,
      snippet: talkOf(id).lines[0]?.text ?? '',
    });
    context.refresh();
  }, SETTLE_MS);
}
