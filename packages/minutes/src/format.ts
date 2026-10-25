export interface TimeOptions {
  timeZone?: string | undefined;
  locale?: string | undefined;
  dateStyle?: 'full' | 'long' | 'medium' | 'short' | undefined;
  hour12?: boolean | undefined;
  rangeSeparator?: string | undefined;
}

export function formatDate(iso: string, options: TimeOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale ?? 'en-GB', {
    dateStyle: options.dateStyle ?? 'full',
    ...(options.timeZone && { timeZone: options.timeZone }),
  }).format(new Date(iso));
}

export function formatTimeRange(
  startIso: string,
  endIso: string | null,
  options: TimeOptions = {},
) {
  const format = (iso: string, zoneName: boolean) =>
    new Intl.DateTimeFormat(options.locale ?? 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      ...(options.hour12 === undefined
        ? { hourCycle: 'h23' as const }
        : { hour12: options.hour12 }),
      ...(zoneName && { timeZoneName: 'short' as const }),
      ...(options.timeZone && { timeZone: options.timeZone }),
    }).format(new Date(iso));
  const zone = (iso: string) => format(iso, true).replace(format(iso, false), '').trim();
  const separator = options.rangeSeparator ?? ' to ';
  if (!endIso) return format(startIso, true);
  // A meeting that crosses a DST change shows the zone on both ends.
  const crossesZones = zone(startIso) !== zone(endIso);
  return `${format(startIso, crossesZones)}${separator}${format(endIso, true)}`;
}

export function formatOffset(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export const platformName = (platform: 'meet' | 'teams' | 'recording') =>
  platform === 'meet'
    ? 'Google Meet'
    : platform === 'teams'
      ? 'Microsoft Teams'
      : 'Phone recording';
