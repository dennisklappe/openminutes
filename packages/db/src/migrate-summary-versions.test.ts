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
const LATEST = '0015_summary_versions';

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

describe('summary versions migration', () => {
  it('turns revisions into versions and keeps the summary that was active', async () => {
    const pool = await freshDatabase();
    const folder = await migrationsBefore(LATEST);
    try {
      await migrate(drizzle(pool), { migrationsFolder: folder });
      const { rows: meetings } = await pool.query<{ id: string }>(
        `insert into meetings (title, platform, join_url) values ('m', 'meet', 'u') returning id`,
      );
      const meetingId = meetings[0]?.id;
      const summary = async (content: string, createdAt: string) => {
        const { rows } = await pool.query<{ id: string }>(
          `insert into summaries (meeting_id, provider, model, status, content, created_at)
           values ($1, 'p', 'm', 'done', $2, $3) returning id`,
          [meetingId, content, createdAt],
        );
        return rows[0]?.id ?? '';
      };
      const revision = (summaryId: string, content: string | null, source: string, at: string) =>
        pool.query(
          `insert into summary_revisions (summary_id, content, source, created_at)
           values ($1, $2, $3, $4)`,
          [summaryId, content, source, at],
        );
      const older = await summary('older ai', '2030-01-01T10:00:00Z');
      const latest = await summary('latest ai', '2030-01-02T10:00:00Z');
      await revision(older, 'older edit', 'app', '2030-01-03T10:00:00Z');
      await revision(latest, 'latest edit', 'app', '2030-01-04T10:00:00Z');
      await revision(latest, 'via link', 'link', '2030-01-05T10:00:00Z');
      await revision(latest, null, 'app', '2030-01-06T10:00:00Z');

      await migrateOnStartup(pool);

      const { rows } = await pool.query<{
        content: string;
        origin: string;
        restored_from: string | null;
      }>(
        `select content, origin, restored_from from summaries
         where meeting_id = $1 and status = 'done' order by created_at, id`,
        [meetingId],
      );
      expect(rows.map((r) => [r.origin, r.content])).toEqual([
        ['ai', 'older ai'],
        ['edit', 'older edit'],
        ['ai', 'latest ai'],
        ['edit', 'latest edit'],
        ['link', 'via link'],
        ['restore', 'latest ai'],
      ]);
      expect(rows[5]?.restored_from).toBe(latest);
      await expect(pool.query('select 1 from summary_revisions')).rejects.toThrow();
    } finally {
      await rm(folder, { recursive: true, force: true });
      await pool.end();
    }
  });
});
