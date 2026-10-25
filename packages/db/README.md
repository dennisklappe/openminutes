# @openminutes/db

Drizzle schema, client and migrations for the PostgreSQL database.

## Migrations

- Generate with `pnpm --filter @openminutes/db generate` after changing `src/schema.ts`. Commit the SQL file and its snapshot together.
- Migrations only go forward and run in journal order at startup, under an advisory lock, so several containers can start at once.
- They must run on a populated database. Add columns with a default or as nullable, backfill existing rows in the same file, and only drop a column or table once its data has been moved (see `0007`, `0014` and `0015`).
- Never edit a migration that has shipped. Fix it with a new one.
- There is no down migration. A version that finds migrations it does not know refuses to start (`SchemaTooNewError`); roll back by restoring the backup taken before the upgrade, see [UPGRADING.md](../../UPGRADING.md).
