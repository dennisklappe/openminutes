import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDatabase } from '../client.js';
import { migrateOnStartup } from '../migrate.js';

export function testDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL is not set, add the db global setup to vitest');
  return url;
}

export async function createTestDatabase() {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: testDatabaseUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(testDatabaseUrl());
  url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.toString());
  await migrateOnStartup(pool);
  return { db, pool, url: url.toString(), close: () => pool.end() };
}
