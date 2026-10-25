#!/usr/bin/env bash
# Measures how well speakers are attributed on synthetic meetings, through the real pipeline:
# piper voices speak a script with turn taking, overlaps and interjections, a model of the
# platform's speaking indicator feeds the bot's room tracker, the local whisper service
# transcribes the audio and assignSpeakers lines the two up. Prints the attribution accuracy
# and the word error rate per scenario and fails when two or three speakers drop below 90 percent, or four speakers with a slow, uneven indicator below 97 percent.
# Audio, voices and transcripts are generated into a cache outside git (E2E_CACHE).
# Usage: e2e/transcripts/run.sh   (needs python3 with venv, curl and pnpm install)
set -euo pipefail

here="$(cd "$(dirname "$0")/../.." && pwd)"
cache="${E2E_CACHE:-$HOME/.cache/openminutes-e2e}"
port="${WHISPER_PORT:-8765}"
voices=(en_US-lessac-medium en_US-ryan-medium en_US-amy-medium en_GB-alan-medium en_US-kristin-medium)
hub=https://huggingface.co/rhasspy/piper-voices/resolve/main

mkdir -p "$cache/voices"
[ -x "$cache/venv/bin/python" ] || {
  python3 -m venv "$cache/venv"
  # The pinned av has no wheel for Pythons newer than the image's, so take a compatible newer one.
  sed 's/^av==.*/av>=14,<16/' "$here/services/whisper/requirements.txt" >"$cache/requirements.txt"
  "$cache/venv/bin/pip" install -q -r "$cache/requirements.txt" piper-tts numpy
}
for voice in "${voices[@]}"; do
  lang="${voice%%-*}"
  rest="${voice#*-}"
  path="${lang%%_*}/$lang/${rest%-*}/${rest##*-}/$voice"
  for ext in onnx onnx.json; do
    [ -s "$cache/voices/$voice.$ext" ] || curl -fsSL -o "$cache/voices/$voice.$ext" "$hub/$path.$ext"
  done
done

cd "$here/services/whisper"
WHISPER_DEVICE=cpu WHISPER_COMPUTE_TYPE=int8 "$cache/venv/bin/uvicorn" app:app --port "$port" >"$cache/whisper.log" 2>&1 &
whisper=$!
trap 'kill $whisper' EXIT
until curl -fs "http://127.0.0.1:$port/health" >/dev/null; do sleep 1; done

cd "$here"
WHISPER_URL="http://127.0.0.1:$port" E2E_PYTHON="$cache/venv/bin/python" E2E_CACHE="$cache" \
  pnpm exec vitest run -c e2e/transcripts/vitest.config.ts --disableConsoleIntercept "$@"
