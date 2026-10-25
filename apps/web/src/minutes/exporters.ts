import { loadExportAccess, type CalendarContext, type Endpoints } from '@openminutes/calendar';
import type { Database } from '@openminutes/db';
import {
  createBuiltinExporters,
  createGoogleDocsExporter,
  createOneDriveExporter,
  ExportError,
  type Exporter,
  type ExporterRegistry,
} from '@openminutes/minutes';
import { loadExportConfig } from './export-settings.js';
import { latestLiveShare } from './links.js';
import { createShareLink, partsOf } from './share-routes.js';

export interface WebExporterDeps {
  calendar: CalendarContext;
  endpoints: Endpoints;
  publicUrl: string | undefined;
  fetch?: typeof fetch;
}

export function shareLinkExporter(db: Database, publicUrl: string | undefined): Exporter {
  return {
    id: 'share-link',
    label: 'Shareable link',
    description: 'A private link anyone with the URL can read. It always shows the latest edits.',
    destination: true,
    shareLabel: 'Shareable link',
    grantAccess: ({ emails }) => Promise.resolve({ granted: emails, failed: [] }),
    async export({ meetingId, options, previous, origin }) {
      const base = origin ?? publicUrl?.replace(/\/$/, '');
      if (!base) throw new ExportError('Set OPENMINUTES_PUBLIC_URL to create share links');
      const existing = await latestLiveShare(db, meetingId);
      const row =
        existing ??
        (await createShareLink(db, meetingId, { ...partsOf(options), expiresInDays: null }));
      const outcome = {
        kind: 'link' as const,
        url: `${base}/s/${row.token}`,
        label: 'Open the share link',
        ref: row.id,
      };
      return previous?.ref === row.id ? { ...outcome, url: previous.url } : outcome;
    },
  };
}

export function createWebExporters(deps: WebExporterDeps): ExporterRegistry {
  const { calendar, endpoints } = deps;
  const fetchImpl = deps.fetch ?? fetch;
  return createBuiltinExporters()
    .register(shareLinkExporter(calendar.db, deps.publicUrl))
    .register(
      createGoogleDocsExporter({
        fetch: fetchImpl,
        endpoints: {
          docs: endpoints.google.docs,
          drive: endpoints.google.drive,
          upload: endpoints.google.driveUpload,
        },
        async resolve() {
          const config = await loadExportConfig(calendar.settings);
          const access = await loadExportAccess(calendar, 'google', config.googleAccountId);
          return { ...access, ownerEmail: config.ownerEmail };
        },
      }),
    )
    .register(
      createOneDriveExporter({
        fetch: fetchImpl,
        graph: endpoints.microsoft.graph,
        async resolve() {
          const config = await loadExportConfig(calendar.settings);
          const access = await loadExportAccess(calendar, 'microsoft', config.microsoftAccountId);
          return { ...access, ownerEmail: config.ownerEmail };
        },
      }),
    );
}
