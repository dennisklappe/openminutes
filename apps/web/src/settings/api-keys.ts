import { and, apiKeys, asc, eq, isNull, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { generateApiKey } from '../auth/api-keys.js';
import type { ApiKeyCreatedDto, ApiKeyDto } from '../dto.js';

const MAX_ACTIVE_KEYS = 50;
const DAY_MS = 86_400_000;

const input = z.strictObject({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(['read', 'full']),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]),
});

const toDto = (row: typeof apiKeys.$inferSelect): ApiKeyDto => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  scope: row.scope,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
});

/** The keys other services use to call the API. Cookie sessions only: a key cannot manage keys. */
export function apiKeySettingsRoutes({ db }: { db: Database }): Hono {
  const routes = new Hono();
  const active = isNull(apiKeys.revokedAt);

  routes.get('/', async (c) => {
    const rows = await db.select().from(apiKeys).where(active).orderBy(asc(apiKeys.createdAt));
    return c.json<ApiKeyDto[]>(rows.map(toDto));
  });

  routes.post('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Give the key a name, a scope and an expiry' }, 400);
    const count = (await db.select({ id: apiKeys.id }).from(apiKeys).where(active)).length;
    if (count >= MAX_ACTIVE_KEYS) {
      return c.json({ error: `Revoke a key first, ${MAX_ACTIVE_KEYS} is the maximum` }, 409);
    }
    const { secret, hash, prefix } = generateApiKey();
    const { name, scope, expiresInDays } = body.data;
    const [row] = await db
      .insert(apiKeys)
      .values({
        name,
        scope,
        keyHash: hash,
        prefix,
        expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * DAY_MS),
      })
      .returning();
    if (!row) throw new Error('API key was not created');
    return c.json<ApiKeyCreatedDto>({ key: toDto(row), secret }, 201);
  });

  routes.delete('/:id', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    const revoked = id.success
      ? await db
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(and(eq(apiKeys.id, id.data), active))
          .returning({ id: apiKeys.id })
      : [];
    if (revoked.length === 0) return c.json({ error: 'Key not found' }, 404);
    return c.json({ ok: true });
  });

  return routes;
}
