import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

const MIGRATION_LOCK_ID = 7_431_950_021;
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export class SchemaTooNewError extends Error {
  constructor(unknown: number) {
    super(
      `The database was migrated by a newer version of OpenMinutes (${unknown} migration${unknown === 1 ? '' : 's'} this version does not know). ` +
        'Refusing to start so nothing is damaged. Run the newer version again, or restore the database backup taken before the upgrade.',
    );
  }
}

async function assertSchemaNotNewer(client: pg.PoolClient): Promise<void> {
  const table = await client.query<{ found: string | null }>(
    `select to_regclass('drizzle.__drizzle_migrations') as found`,
  );
  if (!table.rows[0]?.found) return;
  const known = new Set(readMigrationFiles({ migrationsFolder }).map((m) => m.folderMillis));
  const applied = await client.query<{ created_at: string }>(
    'select created_at from drizzle.__drizzle_migrations',
  );
  const unknown = applied.rows.filter((row) => !known.has(Number(row.created_at)));
  if (unknown.length > 0) throw new SchemaTooNewError(unknown.length);
}

export async function migrateOnStartup(pool: pg.Pool): Promise<void> {
  const lock = await pool.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await assertSchemaNotNewer(lock);
    await migrate(drizzle(lock), { migrationsFolder });
  } finally {
    await lock.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    lock.release();
  }
}
