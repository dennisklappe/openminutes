import type { JobSender } from '@openminutes/core';
import { forgetVoices } from '@openminutes/core';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { PeopleDto, PersonDetailDto } from '../dto.js';
import { rememberEnabled } from '../voices/load.js';
import { createPerson, deletePerson, mergePeople, PeopleError, updatePerson } from './edit.js';
import { rejectLine, removeFromProfile, verifyLine } from './lines.js';
import { loadPeopleList, loadPersonDetail, type PeopleDeps } from './load.js';

export interface PeopleRouteDeps extends PeopleDeps {
  queue: JobSender;
}

const uuid = z.uuid();
const name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/\p{Cc}/u.test(value));
const emails = z
  .array(
    z
      .string()
      .trim()
      .max(254)
      .pipe(z.union([z.email(), z.literal('')])),
  )
  .max(20);
const notes = z.string().max(2000).nullable();
const createInput = z.strictObject({ name, emails: emails.optional(), notes: notes.optional() });
const updateInput = z
  .strictObject({ name: name.optional(), emails: emails.optional(), notes: notes.optional() })
  .refine((body) => Object.keys(body).length > 0);
const mergeInput = z.strictObject({ sourceId: uuid });
const moveInput = z.strictObject({ personId: uuid });

export function peopleRoutes(deps: PeopleRouteDeps): Hono {
  const routes = new Hono();

  const detail = async (id: string) => {
    const found = await loadPersonDetail(deps, id);
    return found;
  };

  const guard = async (c: Context, run: () => Promise<Response>) => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PeopleError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  };

  const learn = async (request: Awaited<ReturnType<typeof verifyLine>>) => {
    if (await rememberEnabled(deps.settings)) await deps.queue.send('meeting.learn-voice', request);
  };

  routes.get('/', async (c) => c.json<PeopleDto>(await loadPeopleList(deps)));

  routes.post('/', async (c) => {
    const body = createInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid person' }, 400);
    return guard(c, async () => {
      const created = await createPerson(deps.db, {
        name: body.data.name,
        ...(body.data.emails && { emails: body.data.emails }),
        ...(body.data.notes !== undefined && { notes: body.data.notes }),
      });
      return c.json<PersonDetailDto | undefined>(await detail(created.id), 201);
    });
  });

  routes.get('/:id', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    const found = id.success ? await detail(id.data) : undefined;
    return found ? c.json<PersonDetailDto>(found) : c.json({ error: 'Person not found' }, 404);
  });

  routes.patch('/:id', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Person not found' }, 404);
    const body = updateInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid person' }, 400);
    return guard(c, async () => {
      await updatePerson(deps.db, id.data, {
        ...(body.data.name !== undefined && { name: body.data.name }),
        ...(body.data.emails && { emails: body.data.emails }),
        ...(body.data.notes !== undefined && { notes: body.data.notes }),
      });
      return c.json<PersonDetailDto | undefined>(await detail(id.data));
    });
  });

  routes.post('/:id/merge', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Person not found' }, 404);
    const body = mergeInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Pick the person to merge' }, 400);
    return guard(c, async () => {
      await mergePeople(deps.db, id.data, body.data.sourceId);
      return c.json<PersonDetailDto | undefined>(await detail(id.data));
    });
  });

  routes.delete('/:id', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Person not found' }, 404);
    return guard(c, async () => {
      await deletePerson(deps.db, id.data);
      return c.json<PeopleDto>(await loadPeopleList(deps));
    });
  });

  routes.delete('/:id/voice', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    const found = id.success ? await detail(id.data) : undefined;
    if (!id.success || !found) return c.json({ error: 'Person not found' }, 404);
    await forgetVoices(deps.db, [id.data]);
    return c.json<PersonDetailDto | undefined>(await detail(id.data));
  });

  const lineRoute = (
    path: string,
    method: 'post' | 'delete',
    run: (personId: string, segmentId: string, body: unknown) => Promise<void>,
  ) => {
    routes[method](`/:id/lines/:segmentId${path}`, async (c) => {
      const id = uuid.safeParse(c.req.param('id'));
      const segmentId = uuid.safeParse(c.req.param('segmentId'));
      if (!id.success || !segmentId.success) return c.json({ error: 'Line not found' }, 404);
      return guard(c, async () => {
        await run(id.data, segmentId.data, await c.req.json().catch(() => null));
        return c.json<PersonDetailDto | undefined>(await detail(id.data));
      });
    });
  };

  lineRoute('/verify', 'post', async (personId, segmentId) => {
    await learn(await verifyLine(deps.db, personId, segmentId));
  });
  lineRoute('/reject', 'post', (personId, segmentId) => rejectLine(deps.db, personId, segmentId));
  lineRoute('/move', 'post', async (_personId, segmentId, raw) => {
    const body = moveInput.safeParse(raw);
    if (!body.success) throw new PeopleError('Pick who said it', 400);
    await learn(await verifyLine(deps.db, body.data.personId, segmentId));
  });
  lineRoute('/profile', 'delete', (personId, segmentId) =>
    removeFromProfile(deps.db, personId, segmentId),
  );

  return routes;
}
