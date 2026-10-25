import type { LocalStorage, SettingsStore } from '@openminutes/core';
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  meetingExports,
  or,
  shareLinks,
  sql,
  type Database,
} from '@openminutes/db';
import type { ExporterRegistry, LinkEntry, RenderOptions } from '@openminutes/minutes';
import { loadRenderOptions } from './config.js';

export type PartOverrides = Partial<
  Pick<RenderOptions, 'includeTranscript' | 'includeChat' | 'linksTab'>
>;

type Overrides = Partial<Pick<RenderOptions, 'template' | 'custom'>> & PartOverrides;

const liveShare = (meetingId: string) =>
  and(
    eq(shareLinks.meetingId, meetingId),
    isNull(shareLinks.revokedAt),
    or(isNull(shareLinks.expiresAt), sql`${shareLinks.expiresAt} > now()`),
  );

export async function latestLiveShare(db: Database, meetingId: string) {
  const [row] = await db
    .select()
    .from(shareLinks)
    .where(liveShare(meetingId))
    .orderBy(desc(shareLinks.createdAt))
    .limit(1);
  return row;
}

export async function latestPermanentShare(db: Database, meetingId: string) {
  const [row] = await db
    .select()
    .from(shareLinks)
    .where(and(liveShare(meetingId), isNull(shareLinks.expiresAt)))
    .orderBy(desc(shareLinks.createdAt))
    .limit(1);
  return row;
}

export async function loadLinks(
  db: Database,
  exporters: ExporterRegistry,
  meetingId: string,
  origin: string | undefined,
): Promise<LinkEntry[]> {
  const records = await db
    .select()
    .from(meetingExports)
    .where(eq(meetingExports.meetingId, meetingId))
    .orderBy(asc(meetingExports.createdAt));
  const links = records.map((record) => ({
    label: exporters.get(record.exporterId)?.label ?? record.exporterId,
    url: record.url,
  }));
  if (origin && !records.some((record) => record.exporterId === 'share-link')) {
    const share = await latestLiveShare(db, meetingId);
    if (share) links.unshift({ label: 'Shareable link', url: `${origin}/s/${share.token}` });
  }
  return links;
}

export async function loadMeetingRenderOptions(
  deps: {
    db: Database;
    settings: SettingsStore;
    storage: LocalStorage;
    exporters: ExporterRegistry;
  },
  meetingId: string,
  origin: string | undefined,
  overrides: Overrides = {},
): Promise<RenderOptions> {
  const options = await loadRenderOptions(deps.settings, deps.storage, overrides);
  if (!options.linksTab) return options;
  return { ...options, links: await loadLinks(deps.db, deps.exporters, meetingId, origin) };
}
