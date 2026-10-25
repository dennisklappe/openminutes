#!/usr/bin/env bash
# Drives the Record screen in headless Chromium with a fake microphone (a 37 s meeting spoken by
# three piper voices): consent, recording, a network drop, pause, stop, opening the app offline
# from the service worker, crash recovery (upload and discard) and 390 px screenshots in light
# and dark. It runs the real web app from apps/web/dist on a throwaway embedded Postgres.
# Usage: OUT=/path/to/screenshots e2e/phone/run.sh   (needs the voices from e2e/transcripts/run.sh)
set -euo pipefail

here="$(cd "$(dirname "$0")/../.." && pwd)"
cache="${E2E_CACHE:-$HOME/.cache/openminutes-e2e}"
[ -s "$cache/phone/meeting.wav" ] || "$here/e2e/phone/make-audio.sh"
(cd "$here/apps/web" && pnpm build)
FAKE_AUDIO="$cache/phone/meeting.wav" node "$here/e2e/phone/run.mjs"
