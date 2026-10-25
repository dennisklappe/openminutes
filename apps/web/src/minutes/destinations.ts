import { canExport } from '@openminutes/calendar';
import type { SettingsStore } from '@openminutes/core';
import { calendarAccounts, type Database } from '@openminutes/db';
import type { ExporterRegistry } from '@openminutes/minutes';
import type { DestinationDto } from '../dto.js';

const KEY = 'minutes.destinations';
const DEFAULT_DESTINATIONS = ['share-link'];
const ACCOUNT_PROVIDER: Record<string, 'google' | 'microsoft'> = {
  'google-docs': 'google',
  onedrive: 'microsoft',
};

export async function loadDestinations(settings: SettingsStore): Promise<string[]> {
  const stored = await settings.get(KEY);
  return stored === undefined ? DEFAULT_DESTINATIONS : stored.split(',').filter(Boolean);
}

export async function saveDestinations(
  settings: SettingsStore,
  exporters: ExporterRegistry,
  ids: string[],
): Promise<void> {
  const known = ids.filter((id) => exporters.get(id)?.destination);
  await settings.set(KEY, [...new Set(known)].join(','));
}

export async function destinationList(deps: {
  db: Database;
  settings: SettingsStore;
  secret: string;
  exporters: ExporterRegistry;
}): Promise<DestinationDto[]> {
  const [enabled, accounts] = await Promise.all([
    loadDestinations(deps.settings),
    deps.db.select().from(calendarAccounts),
  ]);
  return deps.exporters
    .list()
    .filter((exporter) => exporter.destination)
    .map((exporter) => {
      const provider = ACCOUNT_PROVIDER[exporter.id];
      const available =
        provider === undefined ||
        accounts.some((a) => a.provider === provider && canExport(a, deps.secret));
      return {
        id: exporter.id,
        label: exporter.label,
        enabled: enabled.includes(exporter.id),
        available,
        ...(!available && {
          unavailableReason: `Connect a ${provider === 'google' ? 'Google' : 'Microsoft'} account with export access below first.`,
        }),
      };
    });
}
