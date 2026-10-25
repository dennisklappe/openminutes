import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const web = new URL('../../apps/web/', import.meta.url);
const requireFrom = (dir) => createRequire(new URL('package.json', dir));
const PASSWORD = 'e2e-password-123';

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** Runs the real web app (built in apps/web/dist) on a throwaway embedded Postgres. */
export async function startRealServer({ uiDir, onJob = () => Promise.resolve() }) {
  const dbDir = new URL('../../packages/db/', import.meta.url);
  const { default: EmbeddedPostgres } = await import(
    pathToFileURL(requireFrom(dbDir).resolve('embedded-postgres')).href
  );
  const databaseDir = await mkdtemp(join(tmpdir(), 'openminutes-e2e-pg-'));
  const pgPort = await freePort();
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port: pgPort,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await postgres.initialise();
  await postgres.start();
  process.env.TEST_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`;

  const load = (name) => {
    const resolved = requireFrom(web).resolve(name);
    return import(pathToFileURL(resolved).href);
  };
  const { createTestDatabase } = await load('@openminutes/db/testing');
  const { LocalStorage, SettingsStore } = await load('@openminutes/core');
  const { createProviders } = await load('@openminutes/calendar');
  const { serve } = await load('@hono/node-server');
  const { createApp } = await import(new URL('dist/app.js', web).href);

  const database = await createTestDatabase();
  const settings = new SettingsStore(database.db, 'e2e-secret-0123456789abcdef');
  const dataDir = await mkdtemp(join(tmpdir(), 'openminutes-e2e-data-'));
  const storage = new LocalStorage(dataDir);
  const app = createApp({
    db: database.db,
    settings,
    storage,
    secret: 'e2e-secret-0123456789abcdef',
    calendarProviders: createProviders(),
    version: '0.0.0',
    queue: { send: (name, payload) => onJob(name, payload) },
    uiRoot: relative(process.cwd(), uiDir),
  });

  const recordings = new Map();
  const observed = async (request) => {
    const path = new URL(request.url).pathname;
    const route = /^\/api\/recordings(?:\/([\w-]+)(?:\/(chunks\/(\d+)|finish))?)?$/.exec(path);
    const input =
      route && request.method === 'POST' && route[2] === 'finish'
        ? await request.clone().json()
        : undefined;
    const response = await app.fetch(request);
    if (route?.[1] && response.ok) {
      const entry = recordings.get(route[1]) ?? { id: route[1], chunks: [], bytes: 0 };
      recordings.set(route[1], entry);
      if (request.method === 'PUT' && route[3] !== undefined) {
        const index = Number(route[3]);
        if (!entry.chunks.includes(index)) entry.chunks.push(index);
        entry.chunks.sort((a, b) => a - b);
        entry.bytes += Number(request.headers.get('content-length') ?? 0);
      }
      if (input) entry.finish = input;
      if (request.method === 'DELETE') entry.discarded = true;
    }
    return response;
  };

  const port = await freePort();
  const server = serve({ fetch: observed, port, hostname: '127.0.0.1' });
  const base = `http://localhost:${port}`;
  const setup = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const [cookie] = setup.headers.getSetCookie();
  const [name, ...rest] = cookie.split(';')[0].split('=');
  await settings.set('wizard.completed', 'true');

  return {
    db: database.db,
    databaseUrl: database.url,
    dataDir,
    settings,
    storage,
    url: base,
    cookie: { name, value: rest.join('='), url: base },
    state: () => [...recordings.values()],
    close: async () => {
      server.close();
      await database.close();
      await postgres.stop();
    },
  };
}
