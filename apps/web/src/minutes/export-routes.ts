import type { LocalStorage, SettingsStore } from '@openminutes/core';
import { asc, eq, meetingExports, type Database } from '@openminutes/db';
import {
  isTemplateId,
  renderMinutesHtml,
  type ExporterRegistry,
  type RenderOptions,
} from '@openminutes/minutes';
import { Hono } from 'hono';
import { z } from 'zod';
import { publicOrigin } from '../accounts/origin.js';
import type { ExporterDto, MeetingExportDto } from '../dto.js';
import { assembleMinutes } from './assemble.js';
import { loadDestinations } from './destinations.js';
import { loadMeetingRenderOptions, type PartOverrides } from './links.js';
import { runExport } from './run-export.js';

interface ExportDeps {
  db: Database;
  settings: SettingsStore;
  storage: LocalStorage;
  exporters: ExporterRegistry;
  publicUrl?: string | undefined;
}

const uuid = z.uuid();
const exportRequest = z.object({
  template: z.string().refine(isTemplateId).optional(),
  includeTranscript: z.boolean().optional(),
  includeChat: z.boolean().optional(),
  includeLinks: z.boolean().optional(),
  mode: z.enum(['update', 'new']).optional(),
});

export function exporterListRoutes(registry: ExporterRegistry, settings: SettingsStore): Hono {
  return new Hono().get('/', async (c) => {
    const enabled = await loadDestinations(settings);
    return c.json<ExporterDto[]>(
      registry.list().map(({ id, label, description, destination }) => ({
        id,
        label,
        description,
        kind: destination ? 'destination' : 'download',
        enabled: !destination || enabled.includes(id),
      })),
    );
  });
}

export function exportRoutes(deps: ExportDeps): Hono {
  const routes = new Hono();

  async function load(
    rawId: string,
    origin: string,
    overrides: Partial<Pick<RenderOptions, 'template'>> & PartOverrides,
  ) {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const minutes = await assembleMinutes(deps, id.data);
    if (!minutes) return undefined;
    return {
      id: id.data,
      minutes,
      options: await loadMeetingRenderOptions(deps, id.data, origin, overrides),
    };
  }

  routes.get('/:id/minutes', async (c) => {
    const flag = (name: string) => {
      const value = c.req.query(name);
      return value === undefined ? undefined : value === '1';
    };
    const [transcript, chat, links] = [flag('transcript'), flag('chat'), flag('links')];
    const loaded = await load(c.req.param('id'), publicOrigin(c, deps.publicUrl), {
      ...(transcript !== undefined && { includeTranscript: transcript }),
      ...(chat !== undefined && { includeChat: chat }),
      ...(links !== undefined && { linksTab: links }),
    });
    if (!loaded) return c.json({ error: 'Meeting not found' }, 404);
    c.header('cache-control', 'no-store');
    c.header(
      'content-security-policy',
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    );
    return c.html(renderMinutesHtml(loaded.minutes, loaded.options));
  });

  routes.post('/:id/export/:exporterId', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    const body = exportRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!id.success) return c.json({ error: 'Meeting not found' }, 404);
    if (!body.success) return c.json({ error: 'Invalid export request' }, 400);
    const result = await runExport(deps, {
      meetingId: id.data,
      exporterId: c.req.param('exporterId'),
      mode: body.data.mode,
      origin: publicOrigin(c, deps.publicUrl),
      overrides: {
        ...(body.data.template &&
          isTemplateId(body.data.template) && { template: body.data.template }),
        ...(body.data.includeTranscript !== undefined && {
          includeTranscript: body.data.includeTranscript,
        }),
        ...(body.data.includeChat !== undefined && { includeChat: body.data.includeChat }),
        ...(body.data.includeLinks !== undefined && { linksTab: body.data.includeLinks }),
      },
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    const { outcome } = result;
    if (outcome.kind !== 'file') {
      return c.json(outcome);
    }
    c.header('content-type', outcome.contentType);
    c.header('content-disposition', `attachment; filename="${outcome.filename}"`);
    c.header('cache-control', 'no-store');
    return c.body(typeof outcome.body === 'string' ? outcome.body : Buffer.from(outcome.body));
  });

  routes.get('/:id/exports', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Meeting not found' }, 404);
    const rows = await deps.db
      .select()
      .from(meetingExports)
      .where(eq(meetingExports.meetingId, id.data))
      .orderBy(asc(meetingExports.createdAt));
    return c.json<MeetingExportDto[]>(
      rows.map((row) => ({
        exporterId: row.exporterId,
        ref: row.ref,
        url: row.url,
        includeTranscript: row.includeTranscript,
        includeChat: row.includeChat,
        includeLinks: row.includeLinks,
        updatedAt: row.updatedAt.toISOString(),
      })),
    );
  });

  return routes;
}
