import {
  loadProviderSettings,
  saveProviderSettings,
  type ProviderKind,
  type SettingsStore,
} from '@openminutes/core';
import { createMailProvider, mailProviders, type MailDeps } from '@openminutes/mail';
import {
  createSummaryProvider,
  createTranscriptionProvider,
  ProviderError,
  summaryProviders,
  transcriptionProviders,
  type Deps,
  type ProviderDefinition,
  type TestResult,
} from '@openminutes/providers';
import { Hono } from 'hono';
import { z } from 'zod';
import type {
  ProviderDto,
  ProviderTestDto,
  AiProviderSettingsDto,
  AiProviderSettingsInput,
} from '../dto.js';
import { describeFields, isSecretField } from './fields.js';

interface SettingsDeps {
  settings: SettingsStore;
  providerDeps?: Partial<Deps> | undefined;
  mailDeps?: Partial<MailDeps> | undefined;
}

interface Testable {
  test(): Promise<TestResult>;
}

interface KindDescriptor {
  registry: Record<string, Pick<ProviderDefinition<Testable>, 'id' | 'label' | 'configSchema'>>;
  create: (id: string, config: unknown, deps: SettingsDeps) => Testable;
}

const kinds: Record<ProviderKind, KindDescriptor> = {
  transcription: {
    registry: transcriptionProviders,
    create: (id, config, deps) => createTranscriptionProvider(id, config, deps.providerDeps),
  },
  summary: {
    registry: summaryProviders,
    create: (id, config, deps) => createSummaryProvider(id, config, deps.providerDeps),
  },
  email: {
    registry: mailProviders,
    create: (id, config, deps) =>
      createMailProvider(id, config, {
        ...(deps.providerDeps?.fetch && { fetch: deps.providerDeps.fetch }),
        ...deps.mailDeps,
      }),
  },
};

const input = z.object({
  provider: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
});

class InvalidSettingsError extends Error {}

function resolveConfig(
  registry: KindDescriptor['registry'],
  { provider, config }: AiProviderSettingsInput,
  stored: Record<string, unknown> = {},
): Record<string, unknown> {
  const definition = registry[provider];
  if (!definition) throw new InvalidSettingsError(`Unknown provider ${provider}`);

  const merged: Record<string, unknown> = {};
  for (const { name, secret } of describeFields(definition.configSchema)) {
    const value = config[name];
    const blank = value === undefined || value === null || value === '';
    if (!blank) merged[name] = value;
    else if (secret && stored[name] !== undefined) merged[name] = stored[name];
  }

  const parsed = definition.configSchema.safeParse(merged);
  if (!parsed.success) {
    throw new InvalidSettingsError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return merged;
}

async function readSettings(
  settings: SettingsStore,
  kind: ProviderKind,
): Promise<AiProviderSettingsDto> {
  const { provider, configs } = await loadProviderSettings(settings, kind);
  const providers = Object.values(kinds[kind].registry).map((definition): ProviderDto => {
    const fields = describeFields(definition.configSchema);
    const stored = configs[definition.id] ?? {};
    return {
      id: definition.id,
      label: definition.label,
      fields,
      values: Object.fromEntries(Object.entries(stored).filter(([name]) => !isSecretField(name))),
      secretsSet: fields.filter((f) => f.secret && stored[f.name] !== undefined).map((f) => f.name),
    };
  });
  return { provider, providers };
}

export function providerSettingsRoutes(kind: ProviderKind, deps: SettingsDeps): Hono {
  const { registry, create } = kinds[kind];
  const routes = new Hono();

  routes.onError((error, c) => {
    if (error instanceof InvalidSettingsError) return c.json({ error: error.message }, 400);
    throw error;
  });

  const parseBody = async (request: Request) => {
    const body = input.safeParse(await request.json().catch(() => null));
    if (!body.success) throw new InvalidSettingsError('Provider and config are required');
    return body.data;
  };

  routes.get('/', async (c) => c.json(await readSettings(deps.settings, kind)));

  routes.put('/', async (c) => {
    const body = await parseBody(c.req.raw);
    const { configs } = await loadProviderSettings(deps.settings, kind);
    const config = resolveConfig(registry, body, configs[body.provider]);
    await saveProviderSettings(deps.settings, kind, body.provider, config);
    return c.json(await readSettings(deps.settings, kind));
  });

  routes.post('/test', async (c) => {
    const body = await parseBody(c.req.raw);
    const { configs } = await loadProviderSettings(deps.settings, kind);
    const config = resolveConfig(registry, body, configs[body.provider]);
    try {
      const result = await create(body.provider, config, deps).test();
      return c.json<ProviderTestDto>({ ok: true, ...(result.detail && { detail: result.detail }) });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      return c.json<ProviderTestDto>({ ok: false, error: error.message });
    }
  });

  return routes;
}
