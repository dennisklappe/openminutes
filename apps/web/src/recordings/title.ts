export function recordingTitle(startedAt: Date, timeZone = 'UTC'): string {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(startedAt);
  const date = part({ day: 'numeric', month: 'short', year: 'numeric' });
  const time = part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const zone = part({ timeZoneName: 'short' }).split(' ').pop();
  return `Recording ${date}, ${time} ${zone}`;
}
