# Upgrading

Full guide with the reasoning: [docs/upgrading.md](docs/upgrading.md).

## Update

```bash
docker compose pull
docker compose up -d
```

Database migrations run by themselves when the containers start. The database and audio volumes are kept.

## Pin a version

Set `OPENMINUTES_TAG` in `.env`. Before 1.0 pin the minor (`0.1`), from 1.0 pin the major (`1`), or pin an exact release (`0.1.3`). Avoid `latest`. All images share one version, so one tag covers them.

## Back up first

```bash
docker compose exec -T db pg_dump -U openminutes -Fc openminutes > openminutes-$(date +%F).dump
docker compose run --rm --no-deps --user root -v "$PWD:/backup" --entrypoint tar web czf /backup/openminutes-data-$(date +%F).tgz -C /data .
```

Keep `OPENMINUTES_SECRET` with the backup.

## Roll back

Migrations only go forward. If the update ran no migration, set `OPENMINUTES_TAG` back and run the two update commands. If it did, the older version refuses to start ("The database was migrated by a newer version of OpenMinutes") and you restore the database dump taken before the update:

```bash
docker compose stop web worker bot
docker compose exec -T db dropdb -U openminutes --if-exists openminutes
docker compose exec -T db createdb -U openminutes openminutes
docker compose exec -T db pg_restore -U openminutes -d openminutes < openminutes-2026-01-01.dump
```

Then set `OPENMINUTES_TAG` to the older version and start again. Anything recorded after the backup is lost.
