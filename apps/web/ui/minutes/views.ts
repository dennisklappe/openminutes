export const MINUTES_VIEWS = [
  { id: 'date', label: 'By date' },
  { id: 'company', label: 'By company' },
  { id: 'person', label: 'By person' },
  { id: 'folders', label: 'My folders' },
] as const;

export type MinutesView = (typeof MINUTES_VIEWS)[number]['id'];

export function minutesView(route: string): MinutesView {
  const segment = /^\/minutes\/([\w-]+)/.exec(route)?.[1];
  return MINUTES_VIEWS.find((view) => view.id === segment)?.id ?? 'date';
}

export const minutesHref = (view: MinutesView) => `#/minutes/${view}`;
