import type { Actions, Context } from './context';

export function settingsActions(context: Context): Actions {
  const { state } = context;
  const confirm = (panel: string | undefined, text: string) => {
    state.feedback = { panel: panel ?? '', text };
    context.render();
  };

  return {
    click: {
      section: (el) => {
        state.section = el.dataset.key ?? 'general';
        state.feedback = null;
        context.render();
        context.focus(`[data-act="section"][data-key="${state.section}"]`);
      },
      choice: (el) => {
        state.settings[el.dataset.key ?? ''] = el.dataset.value ?? '';
        context.render();
      },
      'settings-action': (el) => {
        confirm(el.dataset.panel, el.dataset.text ?? '');
      },
    },
    submit: {
      'settings-save': (form) => {
        confirm(form.dataset.panel, 'Saved.');
      },
    },
  };
}
