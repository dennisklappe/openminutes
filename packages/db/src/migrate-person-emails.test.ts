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

it('turns the single invitee link into a list', async () => {
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
    journal.entries.findIndex((entry) => entry.tag === '0029_person_emails'),
  );
  await writeFile(journalPath, JSON.stringify(journal));

  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const { rows } = await pool.query<{ id: string }>(
      `insert into meetings (title, platform, join_url) values ('m', 'meet', 'u') returning id`,
    );
    const meetingId = rows[0]?.id;
    await pool.query(
      `insert into participants (meeting_id, display_name, invitee_email) values ($1, 'Carla', 'c@x.com'), ($1, 'Bob', null)`,
      [meetingId],
    );
    await pool.query(
      `insert into participant_aliases (original_name, display_name, invitee_email) values ('Acme', 'Carla', 'c@x.com')`,
    );
    await migrateOnStartup(pool);
    const people = await pool.query(
      `select display_name, invitee_emails from participants order by display_name`,
    );
    expect(people.rows).toEqual([
      { display_name: 'Bob', invitee_emails: [] },
      { display_name: 'Carla', invitee_emails: ['c@x.com'] },
    ]);
    const aliases = await pool.query(`select invitee_emails, email from participant_aliases`);
    expect(aliases.rows).toEqual([{ invitee_emails: ['c@x.com'], email: null }]);
  } finally {
    await pool.end();
  }
});
