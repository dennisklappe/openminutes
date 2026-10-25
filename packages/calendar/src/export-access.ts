import { calendarAccounts, eq, type CalendarProviderId } from '@openminutes/db';
import type { CalendarContext } from './context.js';
import { freshAccessToken, openTokens } from './tokens.js';

export const EXPORT_SCOPES: Record<CalendarProviderId, readonly string[]> = {
  google: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/documents',
  ],
  microsoft: ['Files.ReadWrite'],
};

export class ExportAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportAccessError';
  }
}

export function hasExportAccess(provider: CalendarProviderId, scope: string | undefined): boolean {
  const granted = new Set((scope ?? '').toLowerCase().split(/\s+/));
  return EXPORT_SCOPES[provider].every((required) => granted.has(required.toLowerCase()));
}

export const canExport = (account: typeof calendarAccounts.$inferSelect, secret: string) =>
  hasExportAccess(account.provider, openTokens(account.encryptedTokens, secret).scope);

export async function loadExportAccess(
  context: CalendarContext,
  provider: CalendarProviderId,
  accountId: string | undefined,
): Promise<{ accessToken: string; accountEmail: string }> {
  const name = provider === 'google' ? 'Google' : 'Microsoft';
  if (!accountId) {
    throw new ExportAccessError(`Choose a ${name} account under Settings, Minutes first`);
  }
  const [account] = await context.db
    .select()
    .from(calendarAccounts)
    .where(eq(calendarAccounts.id, accountId));
  if (account?.provider !== provider) {
    throw new ExportAccessError(`The chosen ${name} account is no longer connected`);
  }
  if (!canExport(account, context.secret)) {
    throw new ExportAccessError(
      `${account.accountEmail} has not allowed document export yet: use Connect for export under Settings, Minutes`,
    );
  }
  return {
    accessToken: await freshAccessToken(context, account),
    accountEmail: account.accountEmail,
  };
}
