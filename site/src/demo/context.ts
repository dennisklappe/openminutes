import type { Dialog, State } from './state';

export interface Context {
  root: HTMLElement;
  state: State;
  render: (resetScroll?: boolean) => void;
  refresh: () => void;
  say: (text: string) => void;
  notify: (text: string, restore?: () => void) => void;
  open: (dialog: Dialog) => void;
  close: () => void;
  focus: (selector: string) => void;
}

export type Click = (target: HTMLElement, event: MouseEvent) => void;
export type Submit = (form: HTMLFormElement) => void;

export interface Actions {
  click: Record<string, Click>;
  submit: Record<string, Submit>;
}

export const field = (form: HTMLFormElement, name: string): string =>
  ((value) => (typeof value === 'string' ? value.trim() : ''))(new FormData(form).get(name));
