#!/usr/bin/env bash
# Fresh-install end-to-end check of the setup wizard, S3 storage, retention, the meeting limit and
# crash recovery, driven through the web UI with headless Playwright. Uses the same fake services
# as run.sh plus a MinIO container.
# Usage: DOCKER_HOST_SSH=root@host PROJECT=wiz OPENMINUTES_PORT=42110 FAKE_PORT=42111 OUT=/path/to/screenshots e2e/wizard.sh
# Needs ssh, tar and openssl here, and playwright-core with a Chromium install.
set -euo pipefail

host="${DOCKER_HOST_SSH:?set DOCKER_HOST_SSH, for example root@192.0.2.10}"
project="${PROJECT:-openminutes-wizard}"
port="${OPENMINUTES_PORT:-3000}"
fake_port="${FAKE_PORT:-9000}"
remote="/root/$project"
here="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$here/e2e/certs"
[ -f "$here/e2e/certs/fixture.crt" ] || openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -subj /CN=meet.google.com -keyout "$here/e2e/certs/fixture.key" -out "$here/e2e/certs/fixture.crt" 2>/dev/null

ssh "$host" "rm -rf $remote && mkdir -p $remote"
tar -C "$here" --exclude=node_modules --exclude=dist --exclude=.git -cf - . | ssh "$host" "tar -C $remote -xf -"

compose="cd $remote && export OPENMINUTES_SECRET=e2e-secret-0123456789abcdef OPENMINUTES_PORT=$port FAKE_PORT=$fake_port FAKE_URL=http://${host#*@}:$fake_port && docker compose -p $project -f compose.yaml -f e2e/docker-compose.e2e.yml"
trap '[ -n "${KEEP:-}" ] || ssh "$host" "$compose down -v --remove-orphans" >/dev/null 2>&1' EXIT

ssh "$host" "$compose down -v --remove-orphans" >/dev/null 2>&1 || true
for service in web worker bot fixture calendar-fake; do ssh "$host" "$compose build $service"; done
ssh "$host" "$compose up -d"
for _ in $(seq 60); do
  curl -fs "http://${host#*@}:$port/api/session" >/dev/null && break || sleep 2
done

BASE="http://${host#*@}:$port" HOST="$host" COMPOSE="$compose" OUT="${OUT:-$here/e2e/screenshots}" \
  node "$here/e2e/wizard.mjs"
