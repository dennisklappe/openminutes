import { field, type Actions, type Context } from './context';
import { speakersOf, talkOf } from './fakes';
import { currentRow, doc, type Editing } from './state';

const EDIT_FOCUS: Record<Editing, string> = {
  title: '[data-k="title"]',
  company: '[data-k="company"]',
  summary: '[data-k="draft"]',
};

export function detailActions(context: Context): Actions {
  const { state } = context;
  const finish = (what: Editing) => {
    state.editing = null;
    context.render();
    context.focus(`[data-act="edit"][data-what="${what}"]`);
  };
  const setCompany = (name: string) => {
    if (name) currentRow(state).company = name;
    finish('company');
  };
  const input = (selector: string) => context.root.querySelector<HTMLInputElement>(selector);

  return {
    click: {
      edit: (el) => {
        const what = el.dataset.what as Editing;
        state.editing = what;
        state.draft =
          what === 'summary' ? (doc(state).versions[doc(state).active]?.markdown ?? '') : '';
        context.render();
        context.focus(EDIT_FOCUS[what]);
        if (what === 'title') input(EDIT_FOCUS.title)?.select();
      },
      'edit-cancel': () => {
        const what = state.editing;
        if (what) finish(what);
      },
      'company-pick': (el) => {
        setCompany(el.dataset.name ?? '');
      },
      rename: (el) => {
        state.renaming = Number(el.dataset.i);
        context.open('rename');
      },
      speakers: () => {
        context.open('speakers');
      },
    },
    submit: {
      'title-save': (form) => {
        const title = field(form, 'title');
        if (title) currentRow(state).title = title;
        finish('title');
      },
      'company-save': (form) => {
        setCompany(field(form, 'company'));
      },
      'summary-save': (form) => {
        const markdown = form.querySelector('textarea')?.value.trim() ?? '';
        const current = doc(state);
        if (markdown && markdown !== current.versions[current.active]?.markdown) {
          current.versions.push({ markdown, note: 'Edited by hand' });
          current.active = current.versions.length - 1;
          current.undo = null;
        }
        finish('summary');
      },
      'rename-save': (form) => {
        const name = field(form, 'name');
        if (name) state.names[state.renaming] = name;
        context.close();
      },
      'speakers-save': (form) => {
        for (const speaker of speakersOf(talkOf(state.meetingId))) {
          const name = field(form, `s${speaker}`);
          if (name) state.names[speaker] = name;
        }
        context.close();
      },
    },
  };
}
