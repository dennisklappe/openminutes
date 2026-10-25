import type { MeetingStatus } from '../src/dto.js';
import { statusLabels } from './format.js';

export const ALL_STATUSES = Object.keys(statusLabels) as MeetingStatus[];

/** Statuses of meetings the bot tried to join or that were recorded. Skipped and cancelled never started. */
export const NEVER_ATTEMPTED: readonly MeetingStatus[] = ['skipped', 'cancelled'];
export const DEFAULT_STATUSES: MeetingStatus[] = ALL_STATUSES.filter(
  (status) => !NEVER_ATTEMPTED.includes(status),
);

const KEY = 'om-meetings-statuses';

export function sameStatuses(a: readonly MeetingStatus[], b: readonly MeetingStatus[]): boolean {
  return a.length === b.length && a.every((status) => b.includes(status));
}

export const isDefaultStatuses = (selected: readonly MeetingStatus[]) =>
  sameStatuses(selected, DEFAULT_STATUSES);

/** Parse a stored value, ignoring unknown names. Falls back to the default when nothing is left. */
export function parseStatuses(raw: string | null): MeetingStatus[] {
  if (!raw) return DEFAULT_STATUSES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_STATUSES;
    const known = ALL_STATUSES.filter((status) => parsed.includes(status));
    return known.length > 0 ? known : DEFAULT_STATUSES;
  } catch {
    return DEFAULT_STATUSES;
  }
}

export function loadStatuses(): MeetingStatus[] {
  try {
    return parseStatuses(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_STATUSES;
  }
}

export function saveStatuses(selected: readonly MeetingStatus[]): void {
  try {
    if (isDefaultStatuses(selected)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(selected));
  } catch {
    // Private mode or blocked storage: the choice just lasts for this visit.
  }
}

/** The `status` query value. Empty means every status, so the server adds no condition. */
export const statusQuery = (selected: readonly MeetingStatus[]) =>
  selected.length === ALL_STATUSES.length ? '' : selected.join(',');

export function statusSummary(selected: readonly MeetingStatus[]): string {
  if (isDefaultStatuses(selected)) return 'Joined meetings';
  if (selected.length === ALL_STATUSES.length) return 'All statuses';
  if (selected.length === 1 && selected[0]) return statusLabels[selected[0]];
  return `Status: ${String(selected.length)} of ${String(ALL_STATUSES.length)}`;
}
