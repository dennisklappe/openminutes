import type { RunExportDeps } from './run-export.js';
import { runExport } from './run-export.js';
import { loadExportConfig } from './export-settings.js';

export const AUTO_EXPORT_TARGETS = ['google-docs', 'onedrive', 'share-link'] as const;

export async function runAutoExport(
  deps: RunExportDeps & { publicUrl: string | undefined },
  meetingId: string,
): Promise<void> {
  const config = await loadExportConfig(deps.settings);
  if (!config.auto || !config.target) return;
  if (!(AUTO_EXPORT_TARGETS as readonly string[]).includes(config.target)) return;
  const result = await runExport(deps, {
    meetingId,
    exporterId: config.target,
    origin: deps.publicUrl?.replace(/\/$/, ''),
  });
  if (!result.ok) {
    throw new Error(`Automatic export to ${config.target} failed: ${result.error}`);
  }
}
