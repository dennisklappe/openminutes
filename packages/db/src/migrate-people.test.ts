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

it('turns voices, aliases and named participants into people without losing any', async () => {
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
    journal.entries.findIndex((entry) => entry.tag === '0031_people'),
  );
  await writeFile(journalPath, JSON.stringify(journal));

  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const { rows } = await pool.query<{ id: string }>(
      `insert into meetings (title, platform, join_url) values ('m', 'meet', 'u') returning id`,
    );
    const meetingId = rows[0]?.id;
    await pool.query(
      `insert into participants (meeting_id, display_name, name_confirmed, invitee_emails) values
        ($1, 'Carla Voss', true, '["c@x.com"]'),
        ($1, 'Speaker 1', false, '[]'),
        ($1, 'Bob', true, '[]'),
        ($1, 'Dan', false, '[]')`,
      [meetingId],
    );
    await pool.query(
      `insert into participant_aliases (original_name, display_name, invitee_emails, email) values
        ('Acme', 'carla voss', '["c2@x.com"]', 'c3@x.com'),
        ('Zed', 'Erin', '[]', null)`,
    );
    await pool.query(
      `insert into known_voices (name, embedding, samples, email) values
        ('Carla Voss', '[1,0]', 4, 'C@x.com'),
        ('Frank', '[0,1]', 2, null)`,
    );
    await migrateOnStartup(pool);

    const people = await pool.query(
      `select name, emails, voice_prototypes from people order by lower(name)`,
    );
    expect(people.rows).toEqual([
      { name: 'Bob', emails: [], voice_prototypes: [] },
      {
        name: 'Carla Voss',
        emails: ['c2@x.com', 'c3@x.com', 'c@x.com'],
        voice_prototypes: [{ vector: [1, 0], samples: 4, language: 'und' }],
      },
      { name: 'Erin', emails: [], voice_prototypes: [] },
      {
        name: 'Frank',
        emails: [],
        voice_prototypes: [{ vector: [0, 1], samples: 2, language: 'und' }],
      },
    ]);
    const samples = await pool.query(
      `select p.name, s.kind, s.weight from voice_samples s join people p on p.id = s.person_id order by p.name`,
    );
    expect(samples.rows).toEqual([
      { name: 'Carla Voss', kind: 'imported', weight: 4 },
      { name: 'Frank', kind: 'imported', weight: 2 },
    ]);
    const linked = await pool.query(
      `select display_name, person_id is not null as linked from participants order by display_name`,
    );
    expect(linked.rows).toEqual([
      { display_name: 'Bob', linked: true },
      { display_name: 'Carla Voss', linked: true },
      { display_name: 'Dan', linked: false },
      { display_name: 'Speaker 1', linked: false },
    ]);
    expect((await pool.query(`select count(*)::int as n from known_voices`)).rows[0]).toEqual({
      n: 2,
    });
    expect(
      (await pool.query(`select count(*)::int as n from participant_aliases`)).rows[0],
    ).toEqual({
      n: 2,
    });
  } finally {
    await pool.end();
  }
});
