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

it('tags existing lines, samples and profiles with the language of their meeting', async () => {
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
    journal.entries.findIndex((entry) => entry.tag === '0035_voice_languages'),
  );
  await writeFile(journalPath, JSON.stringify(journal));

  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const meeting = async (language: string | null) =>
      (
        await pool.query<{ id: string }>(
          `insert into meetings (title, platform, join_url, language) values ('m', 'meet', 'u', $1) returning id`,
          [language],
        )
      ).rows[0]?.id;
    const dutch = await meeting('nl');
    const english = await meeting('en-US');
    const unknown = await meeting(null);
    const segment = async (meetingId: string | undefined) =>
      (
        await pool.query<{ id: string }>(
          `insert into transcript_segments (meeting_id, start_ms, end_ms, text) values ($1, 0, 3000, 'x') returning id`,
          [meetingId],
        )
      ).rows[0]?.id;
    const dutchLine = await segment(dutch);
    const unknownLine = await segment(unknown);
    const person = (
      await pool.query<{ id: string }>(
        `insert into people (name, voice_prototypes) values ('Dana', '[{"vector":[1,0],"samples":2}]') returning id`,
      )
    ).rows[0]?.id;
    await pool.query(
      `insert into voice_samples (person_id, kind, meeting_id, segment_id, embedding, weight) values
        ($1, 'line', $2, $3, '[1,0]', 1),
        ($1, 'meeting', $4, null, '[1,0]', 3),
        ($1, 'line', $5, $6, '[1,0]', 1)`,
      [person, dutch, dutchLine, english, unknown, unknownLine],
    );
    await migrateOnStartup(pool);

    const lines = await pool.query(
      `select m.language as meeting, s.language from transcript_segments s join meetings m on m.id = s.meeting_id order by m.language nulls last`,
    );
    expect(lines.rows).toEqual([
      { meeting: 'nl', language: 'nl' },
      { meeting: null, language: null },
    ]);
    const samples = await pool.query(
      `select kind, language from voice_samples order by language, kind`,
    );
    expect(samples.rows).toEqual([
      { kind: 'meeting', language: 'en' },
      { kind: 'line', language: 'nl' },
      { kind: 'line', language: 'und' },
    ]);
    const profile = await pool.query(`select voice_prototypes from people`);
    expect(profile.rows).toEqual([
      { voice_prototypes: [{ vector: [1, 0], samples: 2, language: 'en' }] },
    ]);
  } finally {
    await pool.end();
  }
});
