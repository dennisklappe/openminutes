import type { SettingsStore } from '@openminutes/core';
import { GITHUB_DEFAULTS, type GithubContext } from '@openminutes/minutes';

const KEY = 'export.github';

export interface GithubConfig {
  token: string;
  repo: string;
  branch: string;
  folder: string;
  includeTranscript: boolean;
  folderTemplate: string;
  minutesFile: string;
  transcriptFile: string;
}

export async function readGithubConfig(settings: SettingsStore): Promise<GithubConfig | undefined> {
  const raw = await settings.get(KEY);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<GithubConfig>;
    return {
      token: value.token ?? '',
      repo: value.repo ?? '',
      branch: value.branch ?? '',
      folder: value.folder ?? '',
      includeTranscript: value.includeTranscript !== false,
      folderTemplate: value.folderTemplate || GITHUB_DEFAULTS.folderTemplate,
      minutesFile: value.minutesFile || GITHUB_DEFAULTS.minutesFile,
      transcriptFile: value.transcriptFile || GITHUB_DEFAULTS.transcriptFile,
    };
  } catch {
    return undefined;
  }
}

/** The settings the exporter needs, or undefined until a repository and token are saved. */
export async function loadGithubConfig(
  settings: SettingsStore,
): Promise<GithubContext | undefined> {
  const config = await readGithubConfig(settings);
  if (!config?.token || !config.repo) return undefined;
  return {
    token: config.token,
    repo: config.repo,
    branch: config.branch || undefined,
    folder: config.folder,
    includeTranscript: config.includeTranscript,
    folderTemplate: config.folderTemplate,
    minutesFile: config.minutesFile,
    transcriptFile: config.transcriptFile,
  };
}

export async function saveGithubConfig(
  settings: SettingsStore,
  config: GithubConfig | undefined,
): Promise<void> {
  if (!config) await settings.delete(KEY);
  else await settings.set(KEY, JSON.stringify(config));
}
