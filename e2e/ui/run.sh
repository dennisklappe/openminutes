#!/usr/bin/env bash
# Drives the meeting page and Settings in headless Chromium against the real web app on a
# throwaway embedded Postgres: summary versions (edit, regenerate confirmation, restore), the
# Transcript card menus and a layout check that paired settings fields line up. It saves
# screenshots at 1440 and 390 px, light and dark.
# Usage: OUT=/path/to/screenshots e2e/ui/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")/../.." && pwd)"
(cd "$here/apps/web" && pnpm build)
node "$here/e2e/ui/run.mjs"
