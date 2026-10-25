import { ExportAccessError } from '@openminutes/calendar';
import type { LocalStorage, SettingsStore } from '@openminutes/core';
import { and, eq, meetingExports, type Database } from '@openminutes/db';
import {
  ExportError,
  type ExportOutcome,
  type ExporterRegistry,
  type RenderOptions,
} from '@openminutes/minutes';
import { assembleMinutes } from './assemble.js';
import { loadMeetingRenderOptions, type PartOverrides } from './links.js';
import { findShare, partsOf, updateShareParts } from './share-routes.js';

export interface RunExportDeps {
  db: Database;
  settings: SettingsStore;
  storage: LocalStorage;
  exporters: ExporterRegistry;
}

export interface RunExportRequest {
  meetingId: string;
  exporterId: string;
  overrides?: (Partial<Pick<RenderOptions, 'template'>> & PartOverrides) | undefined;
  mode?: 'update' | 'new' | undefined;
  origin?: string | undefined;
}

export type RunExportResult =
  { ok: true; outcome: ExportOutcome } | { ok: false; status: 404 | 422; error: string };

export async function runExport(
  deps: RunExportDeps,
  request: RunExportRequest,
): Promise<RunExportResult> {
  const exporter = deps.exporters.get(request.exporterId);
  if (!exporter) return { ok: false, status: 404, error: 'Unknown exporter' };
  const minutes = await assembleMinutes(deps, request.meetingId);
  if (!minutes) return { ok: false, status: 404, error: 'Meeting not found' };
  const options = await loadMeetingRenderOptions(
    deps,
    request.meetingId,
    request.origin,
    request.overrides,
  );
  const [record] =
    request.mode === 'new'
      ? []
      : await deps.db
          .select()
          .from(meetingExports)
          .where(
            and(
              eq(meetingExports.meetingId, request.meetingId),
              eq(meetingExports.exporterId, exporter.id),
            ),
          );
  try {
    const outcome = await exporter.export({
      meetingId: request.meetingId,
      minutes,
      options,
      origin: request.origin,
      previous: record && { ref: record.ref, url: record.url },
    });
    if (outcome.kind === 'link' && outcome.ref) {
      const asked = request.overrides;
      const explicit =
        asked?.includeTranscript !== undefined ||
        asked?.includeChat !== undefined ||
        asked?.linksTab !== undefined;
      // A link that already exists keeps what it shows unless this request says otherwise.
      const shared =
        exporter.id === 'share-link'
          ? explicit
            ? await updateShareParts(deps.db, request.meetingId, outcome.ref, partsOf(options))
            : await findShare(deps.db, request.meetingId, outcome.ref)
          : undefined;
      const values = {
        ref: outcome.ref,
        url: outcome.url,
        ...(shared ?? partsOf(options)),
        updatedAt: new Date(),
      };
      await deps.db
        .insert(meetingExports)
        .values({ meetingId: request.meetingId, exporterId: exporter.id, ...values })
        .onConflictDoUpdate({
          target: [meetingExports.meetingId, meetingExports.exporterId],
          set: values,
        });
    }
    return { ok: true, outcome };
  } catch (error) {
    if (error instanceof ExportError || error instanceof ExportAccessError) {
      return { ok: false, status: 422, error: error.message };
    }
    throw error;
  }
}
