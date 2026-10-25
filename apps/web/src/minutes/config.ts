import { loadTimeZone, type LocalStorage, type SettingsStore } from '@openminutes/core';
import {
  DEFAULT_TEMPLATE,
  defaultCustomTemplate,
  parseCustomTemplate,
  type CustomTemplate,
  detectLogo,
  isTemplateId,
  logoExtensions,
  type MinutesLogo,
  type RenderOptions,
  type TemplateId,
} from '@openminutes/minutes';
import { readFile } from 'node:fs/promises';

export interface MinutesConfig {
  template: TemplateId;
  custom: CustomTemplate;
  includeTranscript: boolean;
  includeChat: boolean;
  linksTab: boolean;
  timeZone: string;
}

async function includeChat(settings: SettingsStore): Promise<boolean> {
  return (await settings.get('minutes.include_chat')) === 'true';
}

async function loadCustomTemplate(settings: SettingsStore): Promise<CustomTemplate> {
  const stored = await settings.get('minutes.custom_template');
  if (!stored) return defaultCustomTemplate;
  try {
    const parsed = parseCustomTemplate(JSON.parse(stored));
    return parsed.ok ? parsed.template : defaultCustomTemplate;
  } catch {
    return defaultCustomTemplate;
  }
}

export async function loadMinutesConfig(settings: SettingsStore): Promise<MinutesConfig> {
  const [template, custom, includeTranscript, chat, linksTab, timeZone] = await Promise.all([
    settings.get('minutes.template'),
    loadCustomTemplate(settings),
    settings.get('minutes.include_transcript'),
    includeChat(settings),
    settings.get('minutes.links_tab'),
    loadTimeZone(settings),
  ]);
  return {
    template: template && isTemplateId(template) ? template : DEFAULT_TEMPLATE,
    custom,
    includeTranscript: includeTranscript === 'true',
    includeChat: chat,
    linksTab: linksTab === 'true',
    timeZone,
  };
}

/** What a new link shows, as set in Settings, Minutes. */
export async function defaultShareParts(settings: SettingsStore) {
  const config = await loadMinutesConfig(settings);
  return {
    includeTranscript: config.includeTranscript,
    includeChat: config.includeChat,
    includeLinks: config.linksTab,
  };
}

export async function loadLogo(
  settings: SettingsStore,
  storage: LocalStorage,
): Promise<MinutesLogo | undefined> {
  const path = await settings.get('minutes.logo');
  if (!path || !(await storage.exists(path))) return undefined;
  const data = new Uint8Array(await readFile(storage.absolutePath(path)));
  const contentType = detectLogo(data);
  return contentType && { contentType, data };
}

export async function saveLogo(
  settings: SettingsStore,
  storage: LocalStorage,
  logo: MinutesLogo,
): Promise<void> {
  await removeLogo(settings, storage);
  const path = `minutes/logo.${logoExtensions[logo.contentType]}`;
  await storage.write(path, logo.data);
  await settings.set('minutes.logo', path);
}

export async function removeLogo(settings: SettingsStore, storage: LocalStorage): Promise<void> {
  await Promise.all(
    Object.values(logoExtensions).map((extension) => storage.remove(`minutes/logo.${extension}`)),
  );
  await settings.delete('minutes.logo');
}

export async function loadRenderOptions(
  settings: SettingsStore,
  storage: LocalStorage,
  overrides: Partial<
    Pick<RenderOptions, 'template' | 'custom' | 'includeTranscript' | 'includeChat' | 'linksTab'>
  > = {},
): Promise<RenderOptions> {
  const [config, logo] = await Promise.all([
    loadMinutesConfig(settings),
    loadLogo(settings, storage),
  ]);
  return { ...config, ...overrides, logo };
}
