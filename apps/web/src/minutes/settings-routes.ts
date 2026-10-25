import { type LocalStorage, type SettingsStore } from '@openminutes/core';
import type { Database } from '@openminutes/db';
import {
  customDateFormats,
  customFonts,
  customLogoPlacements,
  customTimeFormats,
  demoMinutes,
  detectLogo,
  isTemplateId,
  MAX_EXTRA_LENGTH,
  MAX_LOGO_BYTES,
  MAX_TEMPLATE_BYTES,
  MAX_TITLE_LENGTH,
  parseCustomTemplate,
  renderMinutesHtml,
  templates,
  type CustomTemplate,
  type ExporterRegistry,
  type TemplateId,
} from '@openminutes/minutes';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { MinutesSettingsDto } from '../dto.js';
import { destinationList, saveDestinations } from './destinations.js';
import { loadLogo, loadMinutesConfig, loadRenderOptions, removeLogo, saveLogo } from './config.js';

interface MinutesSettingsDeps {
  db: Database;
  settings: SettingsStore;
  storage: LocalStorage;
  secret: string;
  exporters: ExporterRegistry;
}

const templateField = z.custom<TemplateId>(
  (value) => typeof value === 'string' && isTemplateId(value),
  'Unknown template',
);

const input = z.object({
  template: templateField,
  custom: z.unknown().optional(),
  includeTranscript: z.boolean(),
  includeChat: z.boolean(),
  linksTab: z.boolean(),
  destinations: z.array(z.string()).max(20),
});

const previewInput = z.object({
  template: templateField,
  custom: z.unknown(),
  includeTranscript: z.boolean(),
  includeChat: z.boolean(),
  linksTab: z.boolean(),
});

const customChoices = {
  fonts: [...customFonts],
  logoPlacements: [...customLogoPlacements],
  dateFormats: [...customDateFormats],
  timeFormats: [...customTimeFormats],
  maxTitleLength: MAX_TITLE_LENGTH,
  maxExtraLength: MAX_EXTRA_LENGTH,
};

const customOption = {
  id: 'custom',
  name: 'Custom',
  description: 'Your own colour, font, sections and wording.',
};

type Checked = { ok: true; template: CustomTemplate } | { ok: false; error: string };

function checkCustom(value: unknown): Checked {
  if (JSON.stringify(value ?? null).length > MAX_TEMPLATE_BYTES) {
    return { ok: false, error: 'The template is too large' };
  }
  const parsed = parseCustomTemplate(value);
  return parsed.ok ? parsed : { ok: false, error: parsed.errors.join('. ') };
}

export function minutesSettingsRoutes(deps: MinutesSettingsDeps): Hono {
  const { settings, storage, exporters } = deps;
  const routes = new Hono();

  const read = async (): Promise<MinutesSettingsDto> => {
    const [config, logo, destinations] = await Promise.all([
      loadMinutesConfig(settings),
      loadLogo(settings, storage),
      destinationList(deps),
    ]);
    return {
      ...config,
      destinations,
      customChoices,
      hasLogo: logo !== undefined,
      templates: [
        ...templates.map(({ id, name, description }) => ({ id, name, description })),
        customOption,
      ],
    };
  };

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid minutes settings' }, 400);
    if (body.data.custom !== undefined) {
      const custom = checkCustom(body.data.custom);
      if (!custom.ok) return c.json({ error: custom.error }, 400);
      await settings.set('minutes.custom_template', JSON.stringify(custom.template));
    }
    await settings.set('minutes.template', body.data.template);
    await settings.set('minutes.include_transcript', String(body.data.includeTranscript));
    await settings.set('minutes.include_chat', String(body.data.includeChat));
    await settings.set('minutes.links_tab', String(body.data.linksTab));
    await saveDestinations(settings, exporters, body.data.destinations);
    return c.json(await read());
  });

  routes.put(
    '/logo',
    bodyLimit({
      maxSize: MAX_LOGO_BYTES,
      onError: (c) => c.json({ error: 'The logo must be 512 KB or smaller' }, 413),
    }),
    async (c) => {
      const data = new Uint8Array(await c.req.arrayBuffer());
      const contentType = detectLogo(data);
      if (!contentType) {
        return c.json({ error: 'The logo must be a PNG, JPEG or plain SVG file' }, 400);
      }
      await saveLogo(settings, storage, { contentType, data });
      return c.json(await read());
    },
  );

  routes.delete('/logo', async (c) => {
    await removeLogo(settings, storage);
    return c.json(await read());
  });

  routes.get('/logo', async (c) => {
    const logo = await loadLogo(settings, storage);
    if (!logo) return c.json({ error: 'No logo' }, 404);
    c.header('content-type', logo.contentType);
    c.header('cache-control', 'no-store');
    c.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    c.header('x-content-type-options', 'nosniff');
    return c.body(Buffer.from(logo.data));
  });

  routes.post('/custom/check', async (c) => {
    const custom = checkCustom(await c.req.json().catch(() => null));
    return custom.ok ? c.json(custom.template) : c.json({ error: custom.error }, 400);
  });

  routes.post('/preview', async (c) => {
    const body = previewInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid preview request' }, 400);
    const custom = checkCustom(body.data.custom);
    if (!custom.ok) return c.json({ error: custom.error }, 400);
    const options = await loadRenderOptions(settings, storage, {
      template: body.data.template,
      custom: custom.template,
      includeTranscript: body.data.includeTranscript,
      includeChat: body.data.includeChat,
      linksTab: body.data.linksTab,
    });
    c.header('cache-control', 'no-store');
    return c.json({ html: renderMinutesHtml(demoMinutes, options) });
  });

  return routes;
}
