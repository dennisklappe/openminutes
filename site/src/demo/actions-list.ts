import type { Upcoming } from './data';
import { addLive } from './live';
import type { Actions, Context } from './context';
import { exportFile, saveFile } from './export';

function joinTitle(link: URL): { title: string; platform: 'meet' | 'teams' } {
  const teams = link.hostname.includes('teams');
  const code = link.pathname.split('/').filter(Boolean).at(-1) ?? '';
  return {
    title: teams ? 'Teams meeting' : `Meet ${code}`.trim(),
    platform: teams ? 'teams' : 'meet',
  };
}

export function listActions(context: Context): Actions {
  const { state } = context;
  const rowOf = (id: string | undefined) => state.rows.find((row) => row.id === id);
  const remove = (id: string | undefined, verb: string) => {
    const row = rowOf(id);
    if (!row) return;
    const index = state.rows.indexOf(row);
    state.rows.splice(index, 1);
    state.menu = null;
    context.notify(`${verb} ${row.title}.`, () => {
      state.rows.splice(index, 0, row);
    });
  };

  return {
    click: {
      'menu-close': () => {
        state.menu = null;
        context.render();
      },
      prefill: (el) => {
        const item = state.upcoming[Number(el.dataset.i)] as Upcoming | undefined;
        const input = context.root.querySelector<HTMLInputElement>('[data-k="link"]');
        if (!item || !input) return;
        input.value = item.link;
        input.focus();
        context.say(`Link filled in for ${item.title}. Press Join to send the bot now.`);
      },
      skip: (el) => {
        const index = Number(el.dataset.i);
        const item = state.upcoming[index] as Upcoming | undefined;
        if (!item) return;
        state.upcoming.splice(index, 1);
        state.menu = null;
        context.notify(`The bot will not join ${item.title}.`, () => {
          state.upcoming.splice(index, 0, item);
        });
      },
      archive: (el) => {
        remove(el.dataset.id, 'Archived');
      },
      delete: (el) => {
        remove(el.dataset.id, 'Deleted');
      },
      'row-download': (el) => {
        const id = el.dataset.id ?? '';
        state.menu = null;
        exportFile(state, id, 'transcript-md').then(saveFile, () => {
          context.say('Your browser could not create the file.');
        });
        context.render();
      },
    },
    submit: {
      join: (form) => {
        const input = form.querySelector<HTMLInputElement>('[data-k="link"]');
        if (!input?.value) return;
        const { title, platform } = joinTitle(new URL(input.value));
        addLive(context, {
          kind: 'joined',
          title,
          platform,
          link: input.value,
          minutes: 12,
          people: [0, 2],
        });
        input.value = '';
        context.notify(`The bot is joining ${title}.`);
      },
    },
  };
}
