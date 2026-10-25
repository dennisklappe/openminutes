import {
  archiveMeetings,
  binMeetings,
  loadAudioStorage,
  purgeMeetings,
  restoreMeetings,
  unarchiveMeetings,
  type LocalStorage,
  type SettingsStore,
} from '@openminutes/core';
import { eq, meetings, type Database } from '@openminutes/db';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { BulkResultDto } from '../dto.js';

interface BinDeps {
  db: Database;
  storage: LocalStorage;
  settings: SettingsStore;
}

const MAX_BULK = 200;
const uuid = z.uuid();
const bulkInput = z.object({
  action: z.enum(['archive', 'unarchive', 'delete', 'restore', 'purge']),
  ids: z.array(uuid).min(1).max(MAX_BULK),
});

export function binRoutes(deps: BinDeps): Hono {
  const routes = new Hono();

  const actions = {
    archive: (ids: string[]) => archiveMeetings(deps.db, ids, new Date()),
    unarchive: (ids: string[]) => unarchiveMeetings(deps.db, ids),
    delete: (ids: string[]) => binMeetings(deps.db, ids, new Date()),
    restore: (ids: string[]) => restoreMeetings(deps.db, ids),
    purge: async (ids: string[]) =>
      purgeMeetings(
        { db: deps.db, storage: await loadAudioStorage(deps.settings, deps.storage) },
        ids,
      ),
  };

  routes.post('/bulk', async (c) => {
    const body = bulkInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: `Choose between 1 and ${MAX_BULK} meetings` }, 400);
    const ids = [...new Set(body.data.ids)];
    const changed = (await actions[body.data.action](ids)).length;
    return c.json<BulkResultDto>({ changed, skipped: ids.length - changed });
  });

  const act = (action: keyof typeof actions, conflict: string) => async (c: Context) => {
    const id = uuid.safeParse(c.req.param('id'));
    const [meeting] = id.success
      ? await deps.db.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, id.data))
      : [];
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    return (await actions[action]([meeting.id])).length === 0
      ? c.json({ error: conflict }, 409)
      : c.json({ ok: true });
  };

  routes.post(
    '/:id/archive',
    act(
      'archive',
      'This meeting is still in progress, has not happened yet, or is already archived',
    ),
  );
  routes.post('/:id/unarchive', act('unarchive', 'This meeting is not archived'));
  routes.post('/:id/restore', act('restore', 'This meeting is not in the bin'));

  const softDelete = act(
    'delete',
    "This meeting is still in progress or has not happened yet, choose Don't join instead",
  );
  const deleteForever = act('purge', 'Only a meeting in the bin can be deleted forever');
  routes.delete('/:id', (c) => (c.req.query('forever') === '1' ? deleteForever(c) : softDelete(c)));

  return routes;
}
