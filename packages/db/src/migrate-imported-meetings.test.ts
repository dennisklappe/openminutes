import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import { migrateOnStartup } from './migrate.js';
import { testDatabaseUrl } from './testing/index.js';

const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
const LATEST = '0028_imported_meetings';

async function freshDatabase(): Promise<pg.Pool> {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: testDatabaseUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${name}`;
  return createDatabase(url.toString()).pool;
}

async function migrationsBefore(tag: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'om-migrations-'));
  await cp(migrations, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.slice(
    0,
    journal.entries.findIndex((entry) => entry.tag === tag),
  );
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
}

describe('imported meetings migration', () => {
  it('keeps existing meetings and makes an imported meeting unique by its source id', async () => {
    const pool = await freshDatabase();
    const folder = await migrationsBefore(LATEST);
    try {
      await migrate(drizzle(pool), { migrationsFolder: folder });
      await pool.query(
        `insert into meetings (title, platform, join_url) values ('before', 'meet', 'u')`,
      );

      await migrateOnStartup(pool);

      const insert = (externalId: string | null) =>
        pool.query(
          `insert into meetings (title, platform, join_url, external_id)
           values ('m', 'imported', 'u', $1)`,
          [externalId],
        );
      const { rows } = await pool.query<{ title: string; external_id: string | null }>(
        `select title, external_id from meetings`,
      );
      expect(rows).toEqual([{ title: 'before', external_id: null }]);
      await insert(null);
      await insert(null);
      await insert('fireflies:01ABC');
      await expect(insert('fireflies:01ABC')).rejects.toThrow(/meetings_external_id_idx/);
    } finally {
      await rm(folder, { recursive: true, force: true });
      await pool.end();
    }
  });
});
