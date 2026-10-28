import type { JoinRule, MeetingDto, MeetingStatus, ProgressDto } from '../src/dto.js';

export const statusLabels: Record<MeetingStatus, string> = {
  scheduled: 'Queued',
  uploading: 'Uploading',
  joining: 'Joining',
  in_lobby: 'In lobby',
  recording: 'Recording',
  ended: 'Ended',
  processing: 'Transcribing',
  transcribed: 'Transcribed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

export const platformLabels: Record<MeetingDto['platform'], string> = {
  meet: 'Google Meet',
  teams: 'Microsoft Teams',
  recording: 'Phone recording',
  imported: 'Imported',
};

export const joinRuleLabels: Record<JoinRule, string> = {
  all: 'Join all meetings',
  organizer: 'Only meetings I organize',
  external: 'Only with external guests',
  never: 'Never',
};

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const clock = (date: Date) => date.toLocaleTimeString(undefined, { timeStyle: 'short' });
const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** "Today, 14:00", "Yesterday, 09:30", "Tomorrow, 10:00" or "Oct 19, 11:55". */
export function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((dayStart(date).getTime() - dayStart(now).getTime()) / 86_400_000);
  if (days === 0) return `Today, ${clock(date)}`;
  if (days === -1) return `Yesterday, ${clock(date)}`;
  if (days === 1) return `Tomorrow, ${clock(date)}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(!sameYear && { year: 'numeric' }),
  });
  return `${day}, ${clock(date)}`;
}

/** Compact length: "45s", "5m", "1h 12m". */
export function formatLength(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(Math.round(ms / 1000), 1)}s`;
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${Math.floor(minutes / 60)}h`;
}

const stepLabels: Record<string, string> = {
  preparing: 'Preparing audio',
  transcribing: 'Transcribing',
  repairing: 'Redoing a window',
  speakers: 'Identifying speakers',
  saving: 'Saving',
  'finding-voices': 'Finding the voices again',
  'moving-lines': 'Moving the lines',
  'checking-voices': 'Checking the voices',
};

export function progressLabel(progress: ProgressDto | null, now = Date.now()): string {
  const step = (progress?.step && stepLabels[progress.step]) || 'Starting';
  const count =
    progress?.total && progress.current !== null
      ? ` ${String(progress.current)} of ${String(progress.total)} (${String(Math.round((progress.current / progress.total) * 100))}%)`
      : '';
  const started = progress?.startedAt ? Date.parse(progress.startedAt) : undefined;
  const elapsed = started === undefined ? '' : `, ${formatLength(Math.max(now - started, 0))}`;
  return `${step}${count}${elapsed}`;
}

const DAY_MS = 86_400_000;

/** Whole days until the bin removes a meeting for good, never negative. */
export function daysLeft(purgeAt: string | null, now = Date.now()): number {
  return purgeAt === null
    ? 0
    : Math.max(0, Math.ceil((new Date(purgeAt).getTime() - now) / DAY_MS));
}

export const leftLabel = (days: number): string =>
  days === 0 ? 'Removed today' : `${String(days)} ${days === 1 ? 'day' : 'days'}`;
