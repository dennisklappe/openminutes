import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import { migrateOnStartup, SchemaTooNewError } from './migrate.js';
import { createTestDatabase } from './testing/index.js';

describe('migrateOnStartup', () => {
  it('creates every table from the data model', async () => {
    const test = await createTestDatabase();
    const result = await test.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = result.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'meetings',
        'participants',
        'audio_files',
        'speaker_events',
        'transcript_segments',
        'chat_messages',
        'summaries',
        'calendar_accounts',
        'settings',
      ]),
    );
    await test.close();
  });

  it('is safe when several processes start together', async () => {
    const test = await createTestDatabase();
    const name = `race_${Date.now()}`;
    const admin = new URL(test.url);
    admin.pathname = '/postgres';
    const root = createDatabase(admin.toString());
    await root.pool.query(`create database ${name}`);
    await root.pool.end();

    admin.pathname = `/${name}`;
    const pools = Array.from({ length: 5 }, () => createDatabase(admin.toString()).pool);
    await Promise.all(pools.map((pool) => migrateOnStartup(pool)));
    await Promise.all(pools.map((pool) => migrateOnStartup(pool)));
    await Promise.all(pools.map((pool) => pool.end()));
    await test.close();
  });

  it('refuses to start on a database migrated by a newer version', async () => {
    const test = await createTestDatabase();
    await test.db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('from-the-future', 99999999999999)`,
    );
    await expect(migrateOnStartup(test.pool)).rejects.toThrow(SchemaTooNewError);
    await expect(migrateOnStartup(test.pool)).rejects.toThrow(/restore the database backup/);
    await test.close();
  });
});
