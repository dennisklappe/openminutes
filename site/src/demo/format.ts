const HOUR = 3_600_000;

export const esc = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

export function duration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function length(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes < 1 ? `${Math.max(Math.round(seconds), 1)}s` : `${minutes}m`;
}

const clock = (date: Date) => date.toLocaleTimeString('en-US', { timeStyle: 'short' });
const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export function at(hoursFromNow: number): Date {
  return new Date(Date.now() + hoursFromNow * HOUR);
}

export function when(date: Date): string {
  const days = Math.round(
    (dayStart(date).getTime() - dayStart(new Date()).getTime()) / (24 * HOUR),
  );
  if (days === 0) return `Today, ${clock(date)}`;
  if (days === -1) return `Yesterday, ${clock(date)}`;
  if (days === 1) return `Tomorrow, ${clock(date)}`;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clock(date)}`;
}

export const fullDate = (date: Date) =>
  date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export const clockTime = clock;

export const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('');

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
