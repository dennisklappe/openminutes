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
const LATEST = '0007_meeting_sources';

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

describe('meeting sources migration', () => {
  it('keeps calendar links as sources and merges duplicate rows for the same conference', async () => {
    const pool = await freshDatabase();
    const folder = await migrationsBefore(LATEST);
    try {
      await migrate(drizzle(pool), { migrationsFolder: folder });
      const start = '2030-01-01T10:00:00Z';
      const { rows: accounts } = await pool.query<{ id: string }>(
        `insert into calendar_accounts (provider, account_email, encrypted_tokens)
         values ('google', 'a@example.com', 'x') returning id`,
      );
      const accountId = accounts[0]?.id;
      const calendarIds: string[] = [];
      for (const external of ['one', 'two', 'three']) {
        const { rows } = await pool.query<{ id: string }>(
          `insert into calendars (account_id, external_id, name, join_rule, sync_state)
           values ($1, $2, $2, 'all', '{"token":"t","windowEnd":"2030-01-01"}') returning id`,
          [accountId, external],
        );
        calendarIds.push(rows[0]?.id ?? '');
      }
      const insert = async (
        calendarId: string,
        event: string,
        url: string,
        status: string,
        createdAt: string,
      ) => {
        const { rows } = await pool.query<{ id: string }>(
          `insert into meetings (title, platform, join_url, calendar_id, calendar_event_id, scheduled_start, status, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [
            event,
            url.includes('teams') ? 'teams' : 'meet',
            url,
            calendarId,
            event,
            start,
            status,
            createdAt,
          ],
        );
        return rows[0]?.id ?? '';
      };
      const first = await insert(
        calendarIds[0] ?? '',
        'e1',
        'https://meet.google.com/abc-defg-hij',
        'scheduled',
        '2029-01-01',
      );
      const second = await insert(
        calendarIds[1] ?? '',
        'e2',
        'https://meet.google.com/ABC-DEFG-HIJ?authuser=1',
        'scheduled',
        '2029-01-02',
      );
      const teams = await insert(
        calendarIds[2] ?? '',
        'e3',
        'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=1',
        'scheduled',
        '2029-01-03',
      );

      await migrateOnStartup(pool);

      const { rows: meetings } = await pool.query<{
        id: string;
        status: string;
        join_key: string | null;
      }>('select id, status, join_key from meetings');
      const byId = new Map(meetings.map((m) => [m.id, m]));
      expect(byId.get(first)).toMatchObject({ status: 'scheduled', join_key: 'meet:abc-defg-hij' });
      expect(byId.get(second)).toMatchObject({ status: 'cancelled', join_key: null });
      expect(byId.get(teams)).toMatchObject({
        status: 'scheduled',
        join_key: 'teams:19:meeting_abc@thread.v2',
      });

      const { rows: sources } = await pool.query<{ meeting_id: string; joinable: boolean }>(
        'select meeting_id, joinable from meeting_sources order by calendar_event_id',
      );
      expect(sources.map((s) => s.meeting_id)).toEqual([first, first, teams]);
      expect(sources.every((s) => s.joinable)).toBe(true);

      const { rows: states } = await pool.query<{ sync_state: unknown }>(
        'select sync_state from calendars',
      );
      expect(states.every((row) => row.sync_state === null)).toBe(true);
      await expect(
        pool.query(
          `insert into meetings (title, platform, join_url, join_key, scheduled_start)
           values ('x', 'meet', 'u', 'meet:abc-defg-hij', $1)`,
          [start],
        ),
      ).rejects.toThrow(/meetings_join_key_start_idx/);
    } finally {
      await rm(folder, { recursive: true, force: true });
      await pool.end();
    }
  });
});
