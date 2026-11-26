import type { BotStorageState } from './bot-session-store.js';

const MAX_NAME = 200;

function msalAccountName(value: string): string | undefined {
  if (!value.startsWith('{')) return undefined;
  let entry: unknown;
  try {
    entry = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (typeof entry !== 'object' || entry === null) return undefined;
  const { authorityType, name } = entry as { authorityType?: unknown; name?: unknown };
  if (authorityType !== 'MSSTS' || typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, MAX_NAME);
}

/**
 * The display name of the signed-in Microsoft account, read from the MSAL account entry that
 * Teams keeps in localStorage. Teams shows the bot under this name when it joins signed in.
 * Undefined when the session has no readable entry (Google sessions, an encrypted MSAL cache),
 * or when it holds several different accounts and the one Teams uses is not certain.
 */
export function botAccountName(state: BotStorageState | undefined): string | undefined {
  const names = new Set(
    (state?.origins ?? []).flatMap((origin) =>
      origin.localStorage.flatMap(({ value }) => msalAccountName(value) ?? []),
    ),
  );
  return names.size === 1 ? [...names][0] : undefined;
}
