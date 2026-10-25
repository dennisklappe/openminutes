import {
  shareLinks,
  eq,
  and,
  isNull,
  meetingExports,
  meetings,
  type Database,
} from '@openminutes/db';
import { randomBytes } from 'node:crypto';
import type { RenderOptions } from '@openminutes/minutes';
import { Hono } from 'hono';
import { z } from 'zod';

interface ShareDeps {
  db: Database;
}

const uuid = z.uuid();
const newToken = () => randomBytes(32).toString('base64url');

/** What a link shows besides the minutes. */
export interface ShareParts {
  includeTranscript: boolean;
  includeChat: boolean;
  includeLinks: boolean;
}

export interface NewShareLink {
  includeTranscript: boolean;
  includeChat?: boolean;
  includeLinks?: boolean;
  expiresInDays: number | null;
}

export const partsOf = (options: RenderOptions): ShareParts => ({
  includeTranscript: options.includeTranscript,
  includeChat: options.includeChat === true,
  includeLinks: options.linksTab === true,
});

export async function createShareLink(
  db: Database,
  meetingId: string,
  { expiresInDays, ...parts }: NewShareLink,
): Promise<typeof shareLinks.$inferSelect> {
  const [row] = await db
    .insert(shareLinks)
    .values({
      meetingId,
      token: newToken(),
      ...parts,
      expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000),
    })
    .returning();
  if (!row) throw new Error('Share link was not created');
  return row;
}

const rowParts = (row: ShareParts): ShareParts => ({
  includeTranscript: row.includeTranscript,
  includeChat: row.includeChat,
  includeLinks: row.includeLinks,
});

const partsPatch = z
  .object({
    includeTranscript: z.boolean().optional(),
    includeChat: z.boolean().optional(),
    includeLinks: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((part) => part !== undefined));

export async function findShare(db: Database, meetingId: string, shareId: string) {
  const [row] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.id, shareId), eq(shareLinks.meetingId, meetingId)));
  return row;
}

/** Changes what a live link shows. The URL stays the same and keeps showing the latest summary. */
export async function updateShareParts(
  db: Database,
  meetingId: string,
  shareId: string,
  patch: { [K in keyof ShareParts]?: boolean | undefined },
): Promise<typeof shareLinks.$inferSelect | undefined> {
  const changes = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  const [row] = await db
    .update(shareLinks)
    .set(changes)
    .where(
      and(
        eq(shareLinks.id, shareId),
        eq(shareLinks.meetingId, meetingId),
        isNull(shareLinks.revokedAt),
      ),
    )
    .returning();
  if (!row) return undefined;
  await db
    .update(meetingExports)
    .set({ ...rowParts(row), updatedAt: new Date() })
    .where(
      and(
        eq(meetingExports.meetingId, meetingId),
        eq(meetingExports.exporterId, 'share-link'),
        eq(meetingExports.ref, shareId),
      ),
    );
  return row;
}

export function shareRoutes(deps: ShareDeps): Hono {
  const routes = new Hono();

  async function meetingId(raw: string): Promise<string | undefined> {
    const id = uuid.safeParse(raw);
    if (!id.success) return undefined;
    const [meeting] = await deps.db
      .select({ id: meetings.id })
      .from(meetings)
      .where(eq(meetings.id, id.data));
    return meeting?.id;
  }

  routes.patch('/:id/shares/:shareId', async (c) => {
    const id = await meetingId(c.req.param('id'));
    const shareId = uuid.safeParse(c.req.param('shareId'));
    const body = partsPatch.safeParse(await c.req.json().catch(() => null));
    if (!id || !shareId.success) return c.json({ error: 'Share link not found' }, 404);
    if (!body.success) return c.json({ error: 'Invalid share link change' }, 400);
    const updated = await updateShareParts(deps.db, id, shareId.data, body.data);
    if (!updated) return c.json({ error: 'Share link not found' }, 404);
    return c.json<ShareParts>(rowParts(updated));
  });

  routes.delete('/:id/shares/:shareId', async (c) => {
    const id = await meetingId(c.req.param('id'));
    const shareId = uuid.safeParse(c.req.param('shareId'));
    if (!id || !shareId.success) return c.json({ error: 'Share link not found' }, 404);
    const revoked = await deps.db
      .update(shareLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(shareLinks.id, shareId.data),
          eq(shareLinks.meetingId, id),
          isNull(shareLinks.revokedAt),
        ),
      )
      .returning({ id: shareLinks.id });
    if (revoked.length === 0) return c.json({ error: 'Share link not found' }, 404);
    await deps.db
      .delete(meetingExports)
      .where(
        and(
          eq(meetingExports.meetingId, id),
          eq(meetingExports.exporterId, 'share-link'),
          eq(meetingExports.ref, shareId.data),
        ),
      );
    return c.json({ ok: true });
  });

  return routes;
}
