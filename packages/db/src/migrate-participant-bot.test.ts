import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { expect, it } from 'vitest';
import { createDatabase } from './client.js';
import { migrateOnStartup } from './migrate.js';
import { testDatabaseUrl } from './testing/index.js';

const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));

it('marks the notetaker as a bot and keeps the original name column empty', async () => {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: testDatabaseUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${name}`;
  const pool = createDatabase(url.toString()).pool;

  const folder = await mkdtemp(join(tmpdir(), 'om-migrations-'));
  await cp(migrations, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(
    0,
    journal.entries.findIndex((entry) => entry.tag === '0020_participant_names'),
  );
  await writeFile(journalPath, JSON.stringify(journal));

  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const { rows } = await pool.query<{ id: string }>(
      `insert into meetings (title, platform, join_url) values ('m', 'meet', 'u') returning id`,
    );
    const meetingId = rows[0]?.id;
    for (const person of ['Klappe Notetaker', 'OpenMinutes Notetaker (Guest)', 'Carla']) {
      await pool.query(`insert into participants (meeting_id, display_name) values ($1, $2)`, [
        meetingId,
        person,
      ]);
    }
    await migrateOnStartup(pool);
    const result = await pool.query<{ display_name: string; is_bot: boolean; original_name: null }>(
      `select display_name, is_bot, original_name from participants order by display_name`,
    );
    expect(result.rows).toEqual([
      { display_name: 'Carla', is_bot: false, original_name: null },
      { display_name: 'Klappe Notetaker', is_bot: true, original_name: null },
      { display_name: 'OpenMinutes Notetaker (Guest)', is_bot: true, original_name: null },
    ]);
  } finally {
    await pool.end();
  }
});
