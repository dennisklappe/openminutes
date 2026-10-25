import { detailActions } from './actions-detail';
import { listActions } from './actions-list';
import { recordActions } from './actions-record';
import { settingsActions } from './actions-settings';
import type { Actions, Click, Context, Submit } from './context';
import { MEETING_ID, OPEN_QUESTIONS } from './data';
import { dialog } from './dialogs';
import { exportFile, saveFile, type Format } from './export';
import { talkOf } from './fakes';
import { duration } from './format';
import { libraryScreen } from './library';
import { withoutSection } from './markdown';
import { activeLine, meetingScreen } from './meeting';
import { meetingsScreen } from './meetings';
import { createPlayer } from './player';
import { preview } from './preview';
import { recordScreen } from './record';
import { settingsScreen } from './settings';
import { shell, toast } from './shell';
import {
  doc,
  initialState,
  type Dialog,
  type Grouping,
  type Include,
  type Platform,
  type PreviewTab,
  type Screen,
  type State,
} from './state';

const SCRIPTED = 'remove open questions';
const IDENTITY = ['act', 'key', 'i', 't', 'id', 'name', 'tab', 'k', 'value', 'what', 'panel'];
const identity = (element: Element) =>
  IDENTITY.map((name) => element.getAttribute(`data-${name}`) ?? '').join('|');
const selectorOf = (element: Element) =>
  IDENTITY.filter((name) => element.hasAttribute(`data-${name}`))
    .map((name) => `[data-${name}="${element.getAttribute(`data-${name}`) ?? ''}"]`)
    .join('');
const TOAST_MS = 8000;

export function mount(root: HTMLElement, note: HTMLElement): void {
  const state: State = initialState();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let noteTimer = 0;
  let toastTimer = 0;
  let shownLine = -1;
  let opener = '';

  const say = (text: string) => {
    note.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => (note.textContent = ''), 8000);
  };

  const player = createPlayer(
    () => {
      paint(true);
    },
    () => {
      sync();
      render();
    },
  );
  player.select(MEETING_ID);
  const sync = () => {
    state.time = player.time;
    state.playing = player.playing;
  };

  const screens: Record<Screen, () => string> = {
    meetings: () => meetingsScreen(state),
    meeting: () => meetingScreen(state),
    library: () => libraryScreen(state),
    record: () => recordScreen(state),
    settings: () => settingsScreen(state),
  };

  function render(resetScroll = false) {
    const focused =
      document.activeElement instanceof Element && root.contains(document.activeElement)
        ? identity(document.activeElement)
        : '';
    const caret =
      document.activeElement instanceof HTMLInputElement
        ? document.activeElement.selectionStart
        : null;
    const scrolls = [root.querySelector('.omd-main'), root.querySelector('.transcript')].map(
      (element) => element?.scrollTop ?? 0,
    );
    const overlay = state.preview ? preview(state, state.preview) : '';
    root.innerHTML = shell(state, screens[state.screen]()) + toast(state) + overlay + dialog(state);
    if (!resetScroll) {
      const [main, list] = scrolls;
      const targets = [root.querySelector('.omd-main'), root.querySelector('.transcript')];
      if (targets[0]) targets[0].scrollTop = main;
      if (targets[1]) targets[1].scrollTop = list;
    }
    shownLine = state.tab === 'transcript' ? activeLine(state) : -1;
    root.querySelector('dialog')?.showModal();
    if (focused) {
      const again = [...root.querySelectorAll('[data-act],[data-k]')].find(
        (element) => identity(element) === focused,
      );
      if (again instanceof HTMLElement) {
        again.focus({ preventScroll: true });
        if (caret !== null && again instanceof HTMLInputElement)
          again.setSelectionRange(caret, caret);
      }
    }
  }

  function paint(follow: boolean) {
    sync();
    const { duration: total } = talkOf(state.meetingId);
    const head = root.querySelector<HTMLElement>('.player .head');
    if (head) head.style.left = `${(state.time / total) * 100}%`;
    const clock = root.querySelector('.player .clock');
    if (clock) clock.textContent = `${duration(state.time)} / ${duration(total)}`;
    const line = state.tab === 'transcript' ? activeLine(state) : -1;
    if (line === shownLine) return;
    shownLine = line;
    root.querySelector('.transcript .active')?.classList.remove('active');
    const item = root.querySelector<HTMLElement>(`.transcript li[data-line="${line}"]`);
    item?.classList.add('active');
    const list = item?.parentElement;
    if (follow && item && list) {
      list.scrollTo({
        top: item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2,
        behavior: reduced ? 'auto' : 'smooth',
      });
    }
  }

  const focus = (selector: string) => {
    root.querySelector<HTMLElement>(selector)?.focus();
  };

  const typing = () =>
    root.contains(document.activeElement) &&
    (document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement);

  const refresh = () => {
    if (!state.dialog && !typing()) render();
  };

  const notify = (text: string, restore?: () => void) => {
    state.toast = restore ? { text, restore } : { text };
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      state.toast = null;
      refresh();
    }, TOAST_MS);
    render();
    if (restore) focus('[data-act="toast-undo"]');
  };

  const open = (kind: Dialog) => {
    const active = document.activeElement;
    opener = active instanceof Element && root.contains(active) ? selectorOf(active) : '';
    state.dialog = kind;
    render();
  };

  const close = () => {
    state.dialog = null;
    render();
    if (opener) focus(opener);
  };

  const context: Context = { root, state, render, refresh, say, notify, open, close, focus };

  const go = (screen: Screen) => {
    if (screen !== 'meeting') player.pause();
    Object.assign(state, { screen, menu: null, query: '', platform: 'all', editing: null });
    sync();
    render(true);
  };

  const show = (id: string) => {
    if (id !== state.meetingId) {
      Object.assign(state, {
        meetingId: id,
        tab: 'transcript',
        speaker: null,
        ai: { open: false, instruction: '', useTranscript: false },
      });
      player.select(id);
    }
    state.editing = null;
    state.menu = null;
    state.screen = 'meeting';
    sync();
    render(true);
  };

  const apply = () => {
    const current = doc(state);
    const edit = state.ai.instruction.trim().replace(/\.$/, '').toLowerCase();
    const before = current.versions[current.active]?.markdown ?? '';
    if (edit !== SCRIPTED) {
      say(
        'The demo knows one edit, "Remove open questions". With your own AI provider you can type anything.',
      );
      return;
    }
    const after = withoutSection(before, OPEN_QUESTIONS);
    if (after === before) {
      say('There are no open questions left to remove.');
      return;
    }
    current.versions.push({ markdown: after, note: 'AI edit' });
    current.edits.push({ instruction: state.ai.instruction.trim(), before, after });
    current.undo = { text: `Changed: ${state.ai.instruction.trim()}.`, previous: current.active };
    current.active = current.versions.length - 1;
    state.ai.instruction = '';
  };

  const undo = () => {
    const current = doc(state);
    if (!current.undo) return;
    current.versions.pop();
    current.edits.pop();
    current.active = current.undo.previous;
    current.undo = null;
  };

  const download = (id: string, format: Format) => {
    exportFile(state, id, format).then(saveFile, () => {
      say('Your browser could not create the file.');
    });
  };

  const copy = () => {
    const current = doc(state);
    const text = current.versions[current.active]?.markdown ?? '';
    navigator.clipboard.writeText(text).then(
      () => {
        say('Copied the summary.');
      },
      () => {
        say('Your browser did not allow copying.');
      },
    );
  };

  const modules: Actions[] = [
    listActions(context),
    detailActions(context),
    recordActions(context),
    settingsActions(context),
  ];
  const submits: Partial<Record<string, Submit>> = Object.fromEntries(
    modules.flatMap((m) => Object.entries(m.submit)),
  );

  const actions: Partial<Record<string, Click>> = {
    ...Object.fromEntries(modules.flatMap((m) => Object.entries(m.click))),
    go: (el) => {
      go(el.dataset.to as Screen);
    },
    open: (el) => {
      show(el.dataset.id ?? MEETING_ID);
    },
    tab: (el) => {
      state.tab = el.dataset.key as State['tab'];
      render();
    },
    toggle: () => {
      player.toggle();
    },
    'seek-bar': (el, event) => {
      const box = el.getBoundingClientRect();
      const { duration: total } = talkOf(state.meetingId);
      player.seek(Math.max(0, Math.min((event.clientX - box.left) / box.width, 1)) * total);
    },
    seek: (el) => {
      player.seek(Number(el.dataset.t));
    },
    speaker: (el) => {
      const index = Number(el.dataset.i);
      state.speaker = state.speaker === index ? null : index;
      render();
    },
    menu: (el) => {
      state.menu = state.menu === el.dataset.key ? null : (el.dataset.key ?? null);
      render();
      if (state.menu) focus('[role^="menuitem"]');
    },
    download: (el) => {
      state.menu = null;
      download(state.meetingId, el.dataset.format as Format);
      render();
    },
    'google-doc': () => {
      download(state.meetingId, 'word');
      notify(
        'Google Docs is not connected in the demo, so the Word file was saved. Import it into Google Docs.',
      );
    },
    share: () => {
      open('share');
    },
    send: () => {
      state.link = { ...state.include };
      state.dialog = 'sent';
      render();
    },
    'dialog-close': close,
    'create-link': () => {
      state.link = { ...state.include };
      render();
    },
    'apply-include': () => {
      state.link = { ...state.include };
      render();
    },
    revoke: () => {
      Object.assign(state, { link: null, menu: null });
      render();
    },
    preview: (el) => {
      state.preview = (el.dataset.tab as PreviewTab | undefined) ?? 'minutes';
      render();
      focus('[data-k="preview-close"]');
    },
    'preview-tab': (el) => {
      state.preview = el.dataset.tab as PreviewTab;
      render();
    },
    'preview-close': () => {
      state.preview = null;
      render();
      focus('.minutes-preview-link');
    },
    'ai-open': () => {
      state.ai.open = true;
      render();
      focus('[data-k="ai"]');
    },
    'ai-close': () => {
      state.ai.open = false;
      render();
    },
    'ai-chip': (el) => {
      state.ai.instruction = el.dataset.text ?? '';
      render();
      focus('[data-k="ai"]');
    },
    undo: () => {
      undo();
      render();
    },
    'toast-undo': () => {
      state.toast?.restore?.();
      state.toast = null;
      render();
    },
    'toast-close': () => {
      state.toast = null;
      render();
    },
    copy,
    grouping: (el) => {
      state.grouping = el.dataset.key as Grouping;
      render();
    },
    group: (el) => {
      const name = el.dataset.name ?? '';
      state.collapsed = state.collapsed.includes(name)
        ? state.collapsed.filter((entry) => entry !== name)
        : [...state.collapsed, name];
      render();
    },
    platform: (el) => {
      state.platform = el.dataset.key as Platform;
      render();
    },
  };

  root.addEventListener('click', (event) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-act]') : null;
    const inMenu = event.target instanceof Element && event.target.closest('.menu, .join-choice');
    if (state.menu && !inMenu) {
      state.menu = null;
      render();
    }
    if (!target || target.matches('input, select, form')) return;
    if (target.tagName === 'A' || target.tagName === 'BUTTON') event.preventDefault();
    actions[target.dataset.act ?? '']?.(target, event);
  });

  root.addEventListener('change', (event) => {
    const input = event.target;
    if (input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) {
      if (input.dataset.act === 'rec-speakers') state.recorder.speakers = input.value;
      else if (input.dataset.setting) state.settings[input.dataset.setting] = input.value;
      return;
    }
    if (!(input instanceof HTMLInputElement)) return;
    const act = input.dataset.act;
    if (input.dataset.setting) {
      state.settings[input.dataset.setting] =
        input.type === 'checkbox' ? input.checked : input.value;
      return;
    }
    if (act === 'show-chat') state.showChat = input.checked;
    else if (act === 'include') state.include[input.dataset.key as keyof Include] = input.checked;
    else if (act === 'ai-transcript') state.ai.useTranscript = input.checked;
    else if (act === 'who') {
      const count = root.querySelectorAll('.share-form input:checked').length;
      const label = `${count} ${count === 1 ? 'person' : 'people'}`;
      const confirm = root.querySelector('[data-k="who-count"]');
      const send = root.querySelector<HTMLButtonElement>('[data-k="send"]');
      if (confirm)
        confirm.textContent = count ? `Will email ${label}` : 'Pick at least one person.';
      if (send)
        Object.assign(send, {
          disabled: count === 0,
          textContent: count ? `Share with ${label}` : 'Share',
        });
      return;
    } else return;
    render();
  });

  root.addEventListener('input', (event) => {
    const input = event.target;
    if (input instanceof HTMLTextAreaElement && input.dataset.k === 'draft') {
      state.draft = input.value;
      return;
    }
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.bind === 'query') state.query = input.value;
    else if (input.dataset.bind === 'instruction') state.ai.instruction = input.value;
    else return;
    render();
  });

  root.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.act === 'ai-apply') {
      apply();
      render();
    } else submits[form.dataset.act ?? '']?.(form);
  });

  root.addEventListener(
    'close',
    (event) => {
      if (event.target instanceof HTMLDialogElement && state.dialog) close();
    },
    true,
  );

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (state.menu) {
        const trigger = `[data-act="menu"][data-key="${state.menu}"]`;
        state.menu = null;
        render();
        focus(trigger);
      } else if (state.preview) {
        state.preview = null;
        render();
        focus('.minutes-preview-link');
      } else if (state.editing) {
        actions['edit-cancel']?.(root, new MouseEvent('click'));
      }
    }
    const menu = event.target instanceof HTMLElement ? event.target.closest('[role="menu"]') : null;
    if (menu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
      const at = items.indexOf(event.target as HTMLElement);
      items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      event.preventDefault();
    }
    const tab =
      event.target instanceof HTMLElement && event.target.getAttribute('role') === 'tab'
        ? event.target
        : null;
    if (!tab || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return;
    const tabs = [...(tab.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const next =
      tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.click();
    root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  });

  render(true);
}
