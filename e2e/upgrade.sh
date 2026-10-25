#!/usr/bin/env bash
# Upgrade check on a Docker host: runs an old release of the stack with data, swaps to the current
# tree with `docker compose pull && up -d`, and proves the data survived, migrations ran by
# themselves and a database newer than the app is refused. Images go through a throwaway local
# registry so the real pull path is exercised. The bot image is left out to save disk and time.
# Usage: DOCKER_HOST_SSH=root@host PROJECT=rel OPENMINUTES_PORT=42001 REGISTRY_PORT=42002 e2e/upgrade.sh
# OLD_REF is the git ref the old stack is built from (default: the first commit after the rename to OpenMinutes,
# which still reads the same environment variables as the compose file, with four migrations). Older refs read MINUTD_* variables.
# Needs ssh, git, curl and jq on the machine that runs it.
set -euo pipefail

host="${DOCKER_HOST_SSH:?set DOCKER_HOST_SSH, for example root@192.0.2.10}"
project="${PROJECT:-openminutes-upgrade}"
port="${OPENMINUTES_PORT:-3000}"
registry_port="${REGISTRY_PORT:-5000}"
old_ref="${OLD_REF:-a749318}"
remote="/root/$project"
registry="localhost:$registry_port"
base="http://${host#*@}:$port/api"
here="$(cd "$(dirname "$0")/.." && pwd)"
services="db web worker"

remote_sh() { ssh "$host" "cd $remote/new && export OPENMINUTES_SECRET=upgrade-secret-0123456789abcdef OPENMINUTES_PORT=$port OPENMINUTES_REGISTRY=$registry OPENMINUTES_TAG=${TAG:-old} && $1"; }
compose="docker compose -p $project"
sql() { remote_sh "$compose exec -T db psql -U openminutes -d openminutes -tA -c \"$1\""; }
fail() { echo "FAIL: $1"; exit 1; }
expect() { [ "$2" = "$3" ] || fail "$1: expected '$3', got '$2'"; echo "ok: $1"; }

cleanup() {
  [ -z "${KEEP:-}" ] || return 0
  remote_sh "$compose down -v --remove-orphans" >/dev/null 2>&1 || true
  ssh "$host" "docker rm -f $project-registry >/dev/null 2>&1; docker rmi $registry/openminutes-web:old $registry/openminutes-web:new $registry/openminutes-worker:old $registry/openminutes-worker:new >/dev/null 2>&1; rm -rf $remote" || true
}
trap cleanup EXIT

wait_for_web() {
  for _ in $(seq 60); do
    curl -fs "$base/session" >/dev/null && return 0
    sleep 2
  done
  fail "web did not come up"
}

echo "== sync sources (old: $old_ref, new: working tree)"
ssh "$host" "rm -rf $remote && mkdir -p $remote/old $remote/new"
git -C "$here" archive "$old_ref" | ssh "$host" "tar -C $remote/old -xf -"
tar -C "$here" --exclude=node_modules --exclude=dist --exclude=.git --exclude=e2e/certs -cf - . | ssh "$host" "tar -C $remote/new -xf -"

echo "== build and push old and new images"
ssh "$host" "docker run -d --name $project-registry -p $registry_port:5000 registry:2 >/dev/null"
for target in web worker; do
  ssh "$host" "docker build -q --target $target -t $registry/openminutes-$target:old $remote/old >/dev/null && docker push -q $registry/openminutes-$target:old >/dev/null"
  ssh "$host" "docker build -q --target $target --build-arg OPENMINUTES_VERSION=upgrade-new -t $registry/openminutes-$target:new $remote/new >/dev/null && docker push -q $registry/openminutes-$target:new >/dev/null"
done
ssh "$host" "docker rmi $registry/openminutes-web:new $registry/openminutes-worker:new $registry/openminutes-web:old $registry/openminutes-worker:old >/dev/null"

echo "== start the old stack"
TAG=old remote_sh "$compose pull -q $services && $compose up -d $services"
wait_for_web
[ "$(curl -s "$base/version" | jq -r .version 2>/dev/null)" != upgrade-new ] || fail "the old stack already runs the new version"
old_migrations="$(sql 'select count(*) from drizzle.__drizzle_migrations')"
echo "old migrations applied: $old_migrations"

echo "== create data on the old version"
jar="$(mktemp)"
api() { curl -fs -b "$jar" -c "$jar" -H 'content-type: application/json' "$@"; }
api -d '{"password":"upgrade-password-123"}' "$base/setup" >/dev/null
meeting_id="$(api -d '{"url":"https://meet.google.com/upg-rade-one"}' "$base/meetings" | jq -r .id)"
[ -n "$meeting_id" ] || fail "no meeting created"
sql "insert into settings (key, value, secret) values ('bot.max_duration_minutes', '123', false) on conflict do nothing" >/dev/null
remote_sh "$compose exec -T web sh -c 'echo kept > /data/upgrade-marker'"
echo "meeting $meeting_id"

echo "== back up with the documented commands"
remote_sh "$compose exec -T db pg_dump -U openminutes -Fc openminutes > openminutes-backup.dump"
remote_sh "$compose run --rm --no-deps --user root -v \"\$PWD:/backup\" --entrypoint tar web czf /backup/openminutes-data-backup.tgz -C /data ."
expect "database dump is not empty" "$(remote_sh '[ -s openminutes-backup.dump ] && echo yes || echo no')" yes
expect "data archive is not empty" "$(remote_sh '[ -s openminutes-data-backup.tgz ] && echo yes || echo no')" yes

echo "== upgrade: pull and up -d"
TAG=new remote_sh "$compose pull -q $services && $compose up -d $services"
wait_for_web
for _ in $(seq 30); do
  [ "$(TAG=new remote_sh "docker inspect -f '{{.State.Health.Status}}' \$($compose ps -q web)")" = healthy ] && break
  sleep 2
done

echo "== verify"
expect "container is healthy" "$(TAG=new remote_sh "docker inspect -f '{{.State.Health.Status}}' \$($compose ps -q web)")" healthy
expect "new version is running" "$(curl -fs "$base/version" | jq -r .version)" upgrade-new
new_migrations="$(jq '.entries | length' "$here/packages/db/drizzle/meta/_journal.json")"
[ "$new_migrations" -gt "$old_migrations" ] || fail "OLD_REF has as many migrations as the current tree, pick an older ref"
expect "migrations applied by themselves ($old_migrations to $new_migrations)" "$(sql 'select count(*) from drizzle.__drizzle_migrations')" "$new_migrations"
expect "new table exists" "$(sql "select to_regclass('public.calendar_accounts') is not null")" t
expect "same admin can sign in" "$(curl -fs -H 'content-type: application/json' -d '{"password":"upgrade-password-123"}' "$base/login" -o /dev/null -w '%{http_code}')" 200
expect "meeting survived" "$(api "$base/meetings" | jq -r --arg id "$meeting_id" '[.[] | select(.id == $id)] | length')" 1
expect "setting survived" "$(sql "select value from settings where key = 'bot.max_duration_minutes'")" 123
expect "audio volume survived" "$(TAG=new remote_sh "$compose exec -T web cat /data/upgrade-marker")" kept
expect "worker is running" "$(TAG=new remote_sh "docker inspect -f '{{.State.Running}}' \$($compose ps -q worker)")" true

echo "== downgrade protection"
sql "insert into drizzle.__drizzle_migrations (hash, created_at) values ('from-the-future', 99999999999999)" >/dev/null
TAG=new remote_sh "$compose up -d --force-recreate web"
sleep 15
logs="$(TAG=new remote_sh "$compose logs web --no-log-prefix 2>&1")"
echo "$logs" | grep -q 'migrated by a newer version of OpenMinutes' || fail "web did not refuse to start: $logs"
echo "ok: web refused to start, message: $(echo "$logs" | grep -m1 'migrated by a newer')"
curl -fs "$base/session" >/dev/null && fail "web answered although the schema is newer"
echo "ok: web is not serving"
expect "database was not touched" "$(sql 'select count(*) from drizzle.__drizzle_migrations')" "$((new_migrations + 1))"

echo "== recover after removing the future migration"
sql "delete from drizzle.__drizzle_migrations where hash = 'from-the-future'" >/dev/null
TAG=new remote_sh "$compose up -d --force-recreate web"
wait_for_web
expect "meeting still there" "$(api "$base/meetings" | jq -r --arg id "$meeting_id" '[.[] | select(.id == $id)] | length')" 1

echo "== ok"
