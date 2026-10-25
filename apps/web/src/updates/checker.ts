import type { SettingsStore } from '@openminutes/core';
import { z } from 'zod';
import type { UpdateStatusDto } from '../dto.js';

export const RELEASES_URL = 'https://api.github.com/repos/dennisklappe/openminutes/releases/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const release = z.object({
  tag_name: z.string(),
  html_url: z.url().refine((url) => url.startsWith('https://')),
});
const stored = z.object({
  checkedAt: z.number(),
  version: z.string().optional(),
  url: z.string().optional(),
});
type Stored = z.infer<typeof stored>;

const parts = (version: string) =>
  (version.replace(/^v/, '').split(/[-+]/, 1)[0] ?? '').split('.').map((part) => Number(part) || 0);

export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export interface UpdateCheckerDeps {
  settings: SettingsStore;
  version: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class UpdateChecker {
  private inFlight: Promise<Stored> | undefined;

  constructor(private readonly deps: UpdateCheckerDeps) {}

  async status(): Promise<UpdateStatusDto> {
    const { settings, version } = this.deps;
    if ((await settings.get('updates.enabled')) !== 'true') {
      return { enabled: false, current: version, available: false };
    }
    const latest = await this.latest();
    const dismissed = await settings.get('updates.dismissed');
    const available = latest.version !== undefined && isNewer(latest.version, version);
    return {
      enabled: true,
      current: version,
      available: available && dismissed !== latest.version,
      ...(latest.version && { latest: latest.version }),
      ...(latest.url && { url: latest.url }),
    };
  }

  private async latest(): Promise<Stored> {
    const raw = await this.deps.settings.get('updates.latest');
    const cached = raw ? stored.safeParse(JSON.parse(raw)) : undefined;
    const now = (this.deps.now ?? Date.now)();
    if (cached?.success && now - cached.data.checkedAt < CHECK_INTERVAL_MS) return cached.data;
    this.inFlight ??= this.refresh(now, cached?.success ? cached.data : undefined).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async refresh(now: number, previous: Stored | undefined): Promise<Stored> {
    const next = await this.fetchLatest(now).catch((): Stored => ({ ...previous, checkedAt: now }));
    await this.deps.settings.set('updates.latest', JSON.stringify(next));
    return next;
  }

  private async fetchLatest(now: number): Promise<Stored> {
    const response = await (this.deps.fetch ?? fetch)(RELEASES_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'openminutes-update-check' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const { tag_name, html_url } = release.parse(await response.json());
    return { checkedAt: now, version: tag_name.replace(/^v/, ''), url: html_url };
  }

  async dismiss(version: string): Promise<void> {
    await this.deps.settings.set('updates.dismissed', version);
  }
}
