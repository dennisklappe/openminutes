import type { Row } from './data';
import { at, esc, initials, length, when } from './format';
import { icons } from './icons';
import type { State } from './state';

export const platformIcon = (platform: Row['platform']) =>
  platform === 'phone' ? icons.record : icons[platform];

export const platformName: Record<Row['platform'], string> = {
  meet: 'Google Meet',
  teams: 'Microsoft Teams',
  phone: 'Phone recorder',
};

export function visibleRows(state: State): Row[] {
  const query = state.query.trim().toLowerCase();
  return [...state.rows]
    .sort((a, b) => a.hoursAgo - b.hoursAgo)
    .filter((row) => state.platform === 'all' || row.platform === state.platform)
    .filter((row) =>
      [
        row.title,
        row.company,
        row.snippet,
        ...row.people.map((index) => state.names[index] ?? ''),
      ].some((text) => text.toLowerCase().includes(query)),
    );
}

export function searchBar(state: State, label: string, placeholder: string): string {
  const platforms = (['all', 'meet', 'teams'] as const)
    .map(
      (key) =>
        `<button type="button" data-act="platform" data-key="${key}" aria-pressed="${state.platform === key}">${key === 'all' ? 'All' : key === 'meet' ? 'Meet' : 'Teams'}</button>`,
    )
    .join('');
  return `<label class="search">${icons.search}<input data-k="query" data-bind="query" aria-label="${label}" placeholder="${placeholder}" type="search" value="${esc(state.query)}"></label><div class="segmented" role="group" aria-label="Platform">${platforms}</div>`;
}

export const empty = (what: string) => `<p class="empty">No ${what} match.</p>`;

export function avatars(indexes: number[], people: string[]): string {
  const names = indexes.map((index) => people[index] ?? '');
  const chips = indexes
    .map(
      (index) =>
        `<span class="person" style="--slot: var(--spk-${(index % 8) + 1});">${initials(people[index] ?? '')}</span>`,
    )
    .join('');
  return `<span class="avatars" title="${esc(names.join(', '))}" aria-label="${esc(names.join(', '))}">${chips}</span>`;
}

const pills = {
  transcribed: ['pill-transcribed', 'Transcribed'],
  joining: ['pill-joining', 'Joining'],
  processing: ['pill-processing', 'Processing'],
} as const;

export function pill(status: Row['status']): string {
  const [name, label] = pills[status];
  return `<span class="pill ${name}"><i aria-hidden="true"></i>${label}</span>`;
}

export const rowWhen = (row: Row) => when(at(-row.hoursAgo));
export const rowLength = (row: Row) => (row.minutes ? length(row.minutes * 60) : '-');
