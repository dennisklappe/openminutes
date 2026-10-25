import type { SettingsStore } from './settings.js';

export function isValidTimeZone(value: string | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The instance timezone: the Settings value, then the TZ environment variable, then UTC. */
export function resolveTimeZone(
  setting: string | undefined,
  env: string | undefined = process.env['TZ'],
): string {
  if (isValidTimeZone(setting)) return setting;
  if (isValidTimeZone(env)) return env;
  return 'UTC';
}

export async function loadTimeZone(settings: SettingsStore): Promise<string> {
  return resolveTimeZone(await settings.get('instance.timezone'));
}
