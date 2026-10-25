#!/usr/bin/env bash
# Renders the fake microphone input for the phone recorder test: a short meeting with three piper
# voices as a 16 kHz mono wav in the e2e cache outside git. Needs the venv and voices from
# e2e/transcripts/run.sh.
set -euo pipefail

here="$(cd "$(dirname "$0")/../.." && pwd)"
cache="${E2E_CACHE:-$HOME/.cache/openminutes-e2e}"
out="$cache/phone"
mkdir -p "$out"
"$cache/venv/bin/python" "$here/e2e/transcripts/synth.py" "$here/e2e/phone/meeting.json" "$cache/voices" "$out"
echo "$out/meeting.wav"
