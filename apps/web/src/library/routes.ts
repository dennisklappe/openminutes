import { canonicalCompany, cleanCompany, exactKey } from '@openminutes/core';
import { eq, meetings, minuteFolders, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { FolderDto, LibraryDto } from '../dto.js';
import { listCompanies } from './companies.js';
import { libraryFilter, loadFolders, loadLibrary } from './load.js';

const uuid = z.uuid();
const noControl = (text: string) => !/\p{Cc}/u.test(text);

const folderInput = z.object({
  name: z.string().trim().min(1).max(60).refine(noControl),
  parentId: z.uuid().nullable().optional(),
});
const folderRename = z.object({ name: folderInput.shape.name });
const moveInput = z.object({ folderId: z.uuid().nullable() });
const companyInput = z.object({ company: z.string().trim().max(80).refine(noControl).nullable() });
const renameInput = z.object({
  from: z.string().trim().min(1).max(80),
  to: z.string().trim().min(1).max(80).refine(noControl),
});

export function libraryRoutes({ db }: { db: Database }): Hono {
  const routes = new Hono();

  routes.get('/', async (c) => {
    const filter = libraryFilter.safeParse(c.req.query());
    if (!filter.success) return c.json({ error: 'Invalid filter' }, 400);
    return c.json<LibraryDto>(await loadLibrary(db, filter.data));
  });

  const folderOf = async (rawId: string | null | undefined) => {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const [folder] = await db.select().from(minuteFolders).where(eq(minuteFolders.id, id.data));
    return folder;
  };
  const toDto = ({ id, name, parentId }: typeof minuteFolders.$inferSelect): FolderDto => ({
    id,
    name,
    parentId,
  });

  routes.post('/folders', async (c) => {
    const body = folderInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'The folder name must be 1 to 60 characters' }, 400);
    const parentId = body.data.parentId ?? null;
    if (parentId && !(await folderOf(parentId))) return c.json({ error: 'Folder not found' }, 404);
    const [created] = await db
      .insert(minuteFolders)
      .values({ name: body.data.name, parentId })
      .returning();
    if (!created) throw new Error('folder insert failed');
    return c.json<FolderDto>(toDto(created), 201);
  });

  routes.patch('/folders/:id', async (c) => {
    const folder = await folderOf(c.req.param('id'));
    if (!folder) return c.json({ error: 'Folder not found' }, 404);
    const body = folderRename.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'The folder name must be 1 to 60 characters' }, 400);
    const [updated] = await db
      .update(minuteFolders)
      .set({ name: body.data.name })
      .where(eq(minuteFolders.id, folder.id))
      .returning();
    return c.json<FolderDto>(toDto(updated ?? folder));
  });

  routes.delete('/folders/:id', async (c) => {
    const folder = await folderOf(c.req.param('id'));
    if (!folder) return c.json({ error: 'Folder not found' }, 404);
    await db.transaction(async (tx) => {
      await tx
        .update(meetings)
        .set({ folderId: folder.parentId })
        .where(eq(meetings.folderId, folder.id));
      await tx
        .update(minuteFolders)
        .set({ parentId: folder.parentId })
        .where(eq(minuteFolders.parentId, folder.id));
      await tx.delete(minuteFolders).where(eq(minuteFolders.id, folder.id));
    });
    return c.json<FolderDto[]>(await loadFolders(db));
  });

  const meetingId = (raw: string) => {
    const id = uuid.safeParse(raw);
    return id.success ? id.data : undefined;
  };

  routes.put('/meetings/:id/folder', async (c) => {
    const id = meetingId(c.req.param('id'));
    const body = moveInput.safeParse(await c.req.json().catch(() => null));
    if (!id || !body.success) return c.json({ error: 'Invalid request' }, 400);
    if (body.data.folderId && !(await folderOf(body.data.folderId))) {
      return c.json({ error: 'Folder not found' }, 404);
    }
    const updated = await db
      .update(meetings)
      .set({ folderId: body.data.folderId })
      .where(eq(meetings.id, id))
      .returning({ id: meetings.id });
    return updated.length === 0
      ? c.json({ error: 'Meeting not found' }, 404)
      : c.json({ folderId: body.data.folderId });
  });

  routes.put('/meetings/:id/company', async (c) => {
    const id = meetingId(c.req.param('id'));
    const body = companyInput.safeParse(await c.req.json().catch(() => null));
    if (!id || !body.success) {
      return c.json({ error: 'The company must be at most 80 characters' }, 400);
    }
    const name = cleanCompany(body.data.company ?? '');
    const company = name ? canonicalCompany(name, await listCompanies(db), exactKey) : null;
    const [updated] = await db
      .update(meetings)
      .set({ company, companySource: company ? 'manual' : null })
      .where(eq(meetings.id, id))
      .returning({ company: meetings.company, source: meetings.companySource });
    return updated ? c.json(updated) : c.json({ error: 'Meeting not found' }, 404);
  });

  routes.post('/companies/rename', async (c) => {
    const body = renameInput.safeParse(await c.req.json().catch(() => null));
    const to = cleanCompany(body.success ? body.data.to : undefined);
    if (!body.success || !to) return c.json({ error: 'Give the current and the new name' }, 400);
    const known = await listCompanies(db);
    const target = canonicalCompany(
      to,
      known.filter((name) => name !== body.data.from),
      exactKey,
    );
    const updated = await db
      .update(meetings)
      .set({ company: target, companySource: 'manual' })
      .where(eq(meetings.company, body.data.from))
      .returning({ id: meetings.id });
    return updated.length === 0
      ? c.json({ error: 'No minutes have that company' }, 404)
      : c.json({ company: target, updated: updated.length });
  });

  return routes;
}
