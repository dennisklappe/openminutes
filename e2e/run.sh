#!/usr/bin/env bash
# End-to-end check on a Docker host: fake Meet and Teams pages stand in for the real ones,
# a stub whisper service stands in for the transcription provider and a fake OAuth and calendar
# API stands in for Google and Microsoft.
# Usage: DOCKER_HOST_SSH=root@host PROJECT=openminutes-e2e OPENMINUTES_PORT=41000 FAKE_PORT=41010 e2e/run.sh
# Needs ssh, openssl, curl and jq on the machine that runs it.
set -euo pipefail

host="${DOCKER_HOST_SSH:?set DOCKER_HOST_SSH, for example root@192.0.2.10}"
project="${PROJECT:-openminutes-e2e}"
port="${OPENMINUTES_PORT:-3000}"
fake_port="${FAKE_PORT:-9000}"
fake_url="http://${host#*@}:$fake_port"
remote="/root/$project"
here="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$here/e2e/certs"
[ -f "$here/e2e/certs/fixture.crt" ] || openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -subj /CN=meet.google.com -keyout "$here/e2e/certs/fixture.key" -out "$here/e2e/certs/fixture.crt" 2>/dev/null

ssh "$host" "rm -rf $remote && mkdir -p $remote"
tar -C "$here" --exclude=node_modules --exclude=dist --exclude=.git -cf - . | ssh "$host" "tar -C $remote -xf -"

# Meet links lose their query string when a meeting is created, so the fixture options travel in a lookup id:
# meet_url <label> <query> prints https://meet.google.com/lookup/<label>-<hex of the query>. Teams links keep their query.
meet_url() { echo "https://meet.google.com/lookup/$1-$(printf %s "$2" | od -An -tx1 | tr -d ' \n')"; }
main_where() { if [ "$1" = meet ]; then echo "platform = 'meet' and join_url like '%lookup/main-%'"; else echo "platform = 'teams' and join_url like '%leaveAfter%'"; fi; }

remote_sh() { ssh "$host" "cd $remote && export OPENMINUTES_SECRET=e2e-secret-0123456789abcdef OPENMINUTES_PORT=$port FAKE_PORT=$fake_port FAKE_URL=$fake_url && $1"; }
compose="docker compose -p $project -f compose.yaml -f e2e/docker-compose.e2e.yml"
sql() { remote_sh "$compose exec -T db psql -U openminutes -d openminutes -tA -c \"$1\""; }

trap '[ -n "${KEEP:-}" ] || remote_sh "$compose down -v --remove-orphans" >/dev/null 2>&1' EXIT

remote_sh "$compose up -d --build"
for _ in $(seq 60); do
  curl -fs "http://${host#*@}:$port/api/session" >/dev/null && break || sleep 2
done
sql "insert into settings (key, value) values ('bot.alone_timeout_seconds', '5'), ('bot.lobby_timeout_seconds', '60'), ('bot.max_concurrent', '3') on conflict do nothing" >/dev/null

jar="$(mktemp)"
base="http://${host#*@}:$port/api"
api() { curl -fs -b "$jar" -H 'content-type: application/json' "$@"; }
stt_config() { echo "{\"provider\":\"local\",\"config\":{\"baseUrl\":\"http://stt:8000\",\"token\":\"$1\"}}"; }
curl -fs -c "$jar" -H 'content-type: application/json' -d '{"password":"e2e-password-123"}' "$base/setup" >/dev/null

echo "== transcription settings"
[ "$(api "$base/settings/transcription" | jq -r .provider)" = local ] || { echo "default provider is not local"; exit 1; }
[ "$(api "$base/settings/transcription/test" -d "$(stt_config wrong)" | jq -r .ok)" = false ] || { echo "wrong token was accepted"; exit 1; }
[ "$(api "$base/settings/transcription/test" -d "$(stt_config e2e-token)" | jq -r .ok)" = true ] || { echo "test button failed"; exit 1; }
api -X PUT "$base/settings/transcription" -d "$(stt_config e2e-token)" | jq -c '.providers[] | select(.id == "local") | {values, secretsSet}'

llm_config() { echo "{\"provider\":\"openai-compatible\",\"config\":{\"baseUrl\":\"http://llm:8000/v1\",\"model\":\"stub-model\",\"apiKey\":\"$1\",\"maxInputChars\":80}}"; }

echo "== summary settings"
[ "$(api "$base/settings/summary" | jq -r .provider)" = none ] || { echo "default summary provider is not none"; exit 1; }
[ "$(api "$base/settings/summary/test" -d "$(llm_config wrong)" | jq -r .ok)" = false ] || { echo "wrong llm key was accepted"; exit 1; }
[ "$(api "$base/settings/summary/test" -d "$(llm_config e2e-llm-key)" | jq -r .ok)" = true ] || { echo "summary test button failed"; exit 1; }
api -X PUT "$base/settings/summary" -d "$(llm_config e2e-llm-key)" | grep -q e2e-llm-key && { echo "llm key was returned by the API"; exit 1; }
[ "$(sql "select secret from settings where key = 'summary.configs'")" = t ] || { echo "summary config is not stored as a secret"; exit 1; }
sql "select value from settings where key = 'summary.configs'" | grep -q e2e-llm-key && { echo "llm key is stored in plain text"; exit 1; }

echo "== join via CLI"
remote_sh "$compose exec -T web openminutes join '$(meet_url main 'lobby=2000&leaveAfter=14000&speakers=Alice:1000-4000,Bob:5000-8000&joins=Carol:6000&leaves=Bob:10000')'"
remote_sh "$compose exec -T web openminutes join 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_e2e%40thread.v2/0?lobby=2000&leaveAfter=14000&speakers=Alice:1000-4000,Bob:5000-8000&joins=Carol:6000&leaves=Bob:10000'"
remote_sh "$compose exec -T web openminutes join 'https://zoom.us/j/1'" && { echo "unsupported link was accepted"; exit 1; } || true

wait_for() {
  for _ in $(seq 90); do
    status="$(sql "select status from meetings where $1")"
    case "$status" in transcribed | failed) echo "$status"; return ;; esac
    sleep 2
  done
  echo "timeout (last status: $status)"
}

check_recording() {
  echo "== recorded $1 meeting"
  local result path mean
  result="$(wait_for "$(main_where "$1")")"
  echo "status: $result"
  [ "$result" = transcribed ] || { sql "select error from meetings where $(main_where "$1")"; remote_sh "$compose logs bot worker --tail 80"; exit 1; }
  path="meetings/$(sql "select id from meetings where $(main_where "$1")")/merged.opus"
  echo "audio: $path"
  remote_sh "$compose exec -T worker ffprobe -v error -show_entries stream=codec_name,channels,sample_rate:format=duration -of default=nw=1 /data/$path"
  mean="$(remote_sh "$compose exec -T bot ffmpeg -hide_banner -i /data/$path -af volumedetect -f null - 2>&1" | sed -n 's/.*mean_volume: \(-\?[0-9.]*\) dB.*/\1/p')"
  echo "mean volume: $mean dB"
  awk -v m="$mean" 'BEGIN { exit !(m > -50) }' || { echo "recording is silent"; exit 1; }
}

check_room() {
  echo "== speakers and participants ($1)"
  local id people speakers carol
  id="$(sql "select id from meetings where $(main_where "$1")")"
  people="$(sql "select display_name, left_at - joined_at > interval '1 second' from participants where meeting_id = '$id' order by display_name")"
  echo "$people"
  [ "$(echo "$people" | cut -d'|' -f1 | paste -sd,)" = "Alice,Bob,Carol,OpenMinutes Notetaker" ] || { echo "unexpected participants"; exit 1; }
  speakers="$(sql "select p.display_name, count(*), min(e.start_ms), max(e.end_ms) - min(e.start_ms) from speaker_events e join participants p on p.id = e.participant_id where e.meeting_id = '$id' group by p.display_name order by min(e.start_ms)")"
  echo "$speakers"
  [ "$(echo "$speakers" | cut -d'|' -f1,2 | paste -sd,)" = "Alice|1,Bob|1" ] || { echo "unexpected speaker events"; exit 1; }
  echo "$speakers" | awk -F'|' '$4 < 2000 || $4 > 4500 { bad = 1 } END { exit bad }' || { echo "speaker interval lengths are off"; exit 1; }
  carol="$(sql "select (p.joined_at - m.started_at) > interval '4 seconds' from participants p join meetings m on m.id = p.meeting_id where p.display_name = 'Carol' and m.id = '$id'")"
  [ "$carol" = t ] || { echo "Carol should join mid-meeting"; exit 1; }
}

check_transcript() {
  echo "== transcript ($1)"
  local id speaking detail
  id="$(sql "select id from meetings where $(main_where "$1")")"
  speaking="$(sql "select coalesce(p.display_name, '-') from transcript_segments s left join participants p on p.id = s.participant_id where s.meeting_id = '$id' order by s.start_ms" | paste -sd,)"
  echo "segment speakers: $speaking"
  [ "$speaking" = "Alice,Alice,Bob" ] || { echo "transcript was not aligned to speakers"; exit 1; }
  detail="$(api "$base/meetings/$id")"
  [ "$(echo "$detail" | jq '.segments | length')" = 3 ] || { echo "expected 3 segments (one split at the speaker change)"; exit 1; }
  [ "$(echo "$detail" | jq -r .canTranscribe)" = true ] || { echo "canTranscribe is false"; exit 1; }
  [ "$(curl -fs -b "$jar" -r 0-3 "$base/meetings/$id/audio")" = OggS ] || { echo "merged audio is not ogg"; exit 1; }
  curl -fs -b "$jar" "$base/meetings/$id/transcript.md" | grep -q 'Bob: Came from the stub' || { echo "markdown export is wrong"; exit 1; }
  api "$base/meetings/$id/transcript.json" | jq -e '.segments | length == 3' >/dev/null
}

check_summary() {
  echo "== summary ($1)"
  local id content received
  id="$(sql "select id from meetings where $(main_where "$1")")"
  wait_summaries() { for _ in $(seq 40); do [ "$(sql "select count(*) from summaries where meeting_id = '$id' and status = '$1'")" = "$2" ] && return; sleep 1; done; echo "summaries never reached $2 $1"; sql "select status, error from summaries where meeting_id = '$id'"; exit 1; }
  wait_summaries done 1
  content="$(sql "select content from summaries where meeting_id = '$id'")"
  echo "$content"
  echo "$content" | grep -q 'Stub summary for: You summarise meeting' || { echo "automatic summary is wrong"; exit 1; }
  [ "$(sql "select provider || '/' || model || '/' || prompt_id from summaries where meeting_id = '$id'")" = openai-compatible/stub-model/default ] || { echo "summary metadata is wrong"; exit 1; }
  received="$(remote_sh "$compose exec -T llm node -e 'fetch(\"http://localhost:8000/received\").then(r=>r.text()).then(console.log)'")"
  echo "$received" | jq -e '[.[] | select(.system | startswith("You are given excerpt"))] | length >= 2' >/dev/null || { echo "long transcript was not summarised in parts"; exit 1; }
  echo "$received" | jq -e '[.[] | select(.user | startswith("### Excerpt 1"))] | length >= 1' >/dev/null || { echo "last request did not get the notes"; exit 1; }

  api -X POST "$base/settings/prompts" -d '{"name":"Short","content":"Reply in one line."}' >/dev/null
  local prompt
  prompt="$(api "$base/settings/prompts" | jq -r '.prompts[] | select(.name == "Short") | .id')"
  api -X POST "$base/meetings/$id/summaries" -d "{\"promptId\":\"$prompt\",\"provider\":\"openai-compatible\"}" >/dev/null
  wait_summaries done 2
  [ "$(api "$base/meetings/$id" | jq -r '.summaries[0].promptName')" = Short ] || { echo "regenerate did not use the chosen prompt"; exit 1; }
  curl -fs -b "$jar" "$base/meetings/$id/transcript.md" | grep -q 'Stub summary for: Reply in one line' || { echo "markdown export misses the summary"; exit 1; }
  api "$base/meetings/$id/transcript.json" | jq -e '.summaries | length == 2' >/dev/null || { echo "json export misses the summaries"; exit 1; }

  api -X PUT "$base/settings/summary" -d "$(llm_config bad-key)" >/dev/null
  api -X POST "$base/meetings/$id/summaries" -d '{}' >/dev/null
  wait_summaries failed 1
  sql "select error from summaries where meeting_id = '$id' and status = 'failed'"
  api -X PUT "$base/settings/summary" -d "$(llm_config e2e-llm-key)" >/dev/null
}

check_rerun() {
  echo "== re-run, and a provider error is recorded"
  local id="$1" received
  received="$(remote_sh "$compose exec -T stt node -e 'fetch(\"http://localhost:8000/received\").then(r=>r.text()).then(console.log)'")"
  echo "provider received: $received"
  echo "$received" | grep -q '"ogg":true' || { echo "provider did not receive ogg audio"; exit 1; }
  wait_status() { for _ in $(seq 30); do [ "$(sql "select status from meetings where id = '$id'")" = "$1" ] && return; sleep 1; done; echo "meeting never became $1"; exit 1; }
  api -X POST "$base/meetings/$id/transcribe" >/dev/null
  wait_status transcribed
  api -X PUT "$base/settings/transcription" -d "$(stt_config bad-token)" >/dev/null
  api -X POST "$base/meetings/$id/transcribe" >/dev/null
  wait_status failed
  sql "select status, error from meetings where id = '$id'"
  [ "$(sql "select count(*) from transcript_segments where meeting_id = '$id'")" = 3 ] || { echo "transcript was lost"; exit 1; }
  api -X PUT "$base/settings/transcription" -d "$(stt_config e2e-token)" >/dev/null
  api -X POST "$base/meetings/$id/transcribe" >/dev/null
  wait_status transcribed
}

fixture_events() {
  remote_sh "$compose exec -T -e NODE_TLS_REJECT_UNAUTHORIZED=0 fixture node -e 'fetch(\"https://localhost:8443/__events\").then(r=>r.text()).then(console.log)'" 2>/dev/null
}

check_default_profile() {
  echo "== default bot name, message and no camera ($1)"
  local events
  events="$(fixture_events)"
  [ "$(echo "$events" | jq "[.[] | select(.type == \"joined\" and .platform == \"$1\" and .name == \"OpenMinutes Notetaker\" and .camera == false)] | length")" -ge 1 ] || { echo "fixture did not see OpenMinutes Notetaker join with the camera off"; exit 1; }
}

check_custom_profile() {
  echo "== custom bot name, message and camera frame ($1)"
  local events frame
  events="$(fixture_events)"
  [ "$(echo "$events" | jq "[.[] | select(.type == \"joined\" and .platform == \"$1\" and .name == \"Acme Notes\" and .camera == true)] | length")" -ge 1 ] || { echo "fixture did not see Acme Notes join with the camera on"; exit 1; }
  frame="$(echo "$events" | jq -c '[.[] | select(.type == "camera-frame")] | last')"
  [ -n "$2" ] && echo "$frame" | jq -r '.image' | sed 's/^data:image\/png;base64,//' | base64 -d > "$2"
  echo "$frame" | jq -e '.mean as $got | [32, 96, 208] as $want | [range(0; 3)] | all(. as $i | ($got[$i] - $want[$i]) | fabs <= 24)' >/dev/null || { echo "camera frame $(echo "$frame" | jq -c .mean) is not the uploaded image"; exit 1; }
  echo "camera frame mean $(echo "$frame" | jq -c .mean)"
}

check_chat() {
  local events text
  events="$(fixture_events)"
  text="$(echo "$events" | jq -r "[.[] | select(.type == \"chat\" and (.text | startswith(\"$1\")))] | length")"
  [ "$text" -ge 1 ] || { echo "no chat message starting with '$1' reached the fixture"; exit 1; }
  echo "chat message received: $1"
}

check_recording meet
check_room meet
check_transcript meet
check_summary meet
check_recording teams
check_room teams
check_transcript teams
check_default_profile meet
check_default_profile teams
check_chat "OpenMinutes notetaker is recording notes"
check_rerun "$(sql "select id from meetings where $(main_where meet)")"

echo "== bot settings"
[ "$(api "$base/settings/bot" | jq -r .name)" = 'OpenMinutes Notetaker' ] || { echo "default bot name is wrong"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" -X PUT -H 'content-type: application/json' -d '{"name":"a\nb","joinMessage":""}' "$base/settings/bot")" = 400 ] || { echo "a multi-line name must be rejected"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" -X PUT -H 'content-type: image/png' --data-binary 'not an image' "$base/settings/bot/camera")" = 400 ] || { echo "a non-image must be rejected"; exit 1; }
tile="$(mktemp --suffix=.png)"
ffmpeg -v error -y -f lavfi -i color=c=0x2060d0:s=640x360 -frames:v 1 "$tile"
api -X PUT "$base/settings/bot" -d '{"name":"Acme Notes","joinMessage":"Recording for Acme"}' >/dev/null
curl -fs -b "$jar" -X PUT -H 'content-type: image/png' --data-binary "@$tile" "$base/settings/bot/camera" | jq -c '{name, hasCameraImage}'
for platform in meet teams; do
  case $platform in
    meet) url="$(meet_url custom 'lobby=500&leaveAfter=4000&custom=1')" ;;
    teams) url='https://teams.microsoft.com/l/meetup-join/19%3ameeting_e2e%40thread.v2/0?lobby=500&leaveAfter=4000&custom=1' ;;
  esac
  remote_sh "$compose exec -T web openminutes join '$url' --force"
  result="$(wait_for "platform = '$platform' and join_url like '%custom%'")"
  echo "$platform custom meeting: $result"
  [ "$result" = transcribed ] || exit 1
  check_custom_profile "$platform" "${E2E_OUT:+$E2E_OUT/camera-frame-$platform.png}"
  check_chat "Recording for Acme"
done

echo "== failed joins via API"
expect_failure() {
  curl -fs -b "$jar" -H 'content-type: application/json' -d "{\"url\":\"$2\"}" "$base/meetings" >/dev/null
  result="$(wait_for "join_url = '$2'")"
  error="$(sql "select error from meetings where join_url = '$2'")"
  echo "$1: $result, $error"
  [ "$result" = failed ] && [ "$error" = "$3" ] || exit 1
}

expect_failure "meet denied" "$(meet_url denied 'lobby=500&deny=1')" 'The host denied the request to join'
expect_failure "teams denied" 'https://teams.live.com/meet/9876543210123?p=abc&lobby=500&deny=1' 'The organizer denied the request to join'
expect_failure "teams blocked" 'https://teams.microsoft.com/meet/123456789012?p=abc&blocked=1' 'This tenant blocks anonymous guests'

echo "== signed-in Google Meet"
session_state() { echo "{\"cookies\":[{\"name\":\"SID\",\"value\":\"fixture-session\",\"domain\":\".google.com\",\"path\":\"/\",\"expires\":$1,\"httpOnly\":false,\"secure\":true,\"sameSite\":\"Lax\"}],\"origins\":[]}"; }
[ "$(api "$base/settings/bot/google-session" | jq -r .status)" = missing ] || { echo "a session exists before one was imported"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" -X PUT -H 'content-type: application/json' -d '{"cookies":[],"origins":[]}' "$base/settings/bot/google-session")" = 400 ] || { echo "a file without Google cookies must be rejected"; exit 1; }
signed_query='lobby=500&leaveAfter=4000&signedInOnly=1'
expect_failure "meet signed out" "$(meet_url signedout "$signed_query&guest=1")" 'Google Meet does not allow this guest to join'
api -X PUT "$base/settings/bot/google-session" -d "$(session_state "$(( $(date +%s) + 2592000 ))")" | jq -c .
[ "$(api "$base/settings/bot/google-session" | jq -r .status)" = valid ] || { echo "the imported session is not valid"; exit 1; }
sql "select value from settings where key = 'bot.google_session'" | grep -q fixture-session && { echo "the session is stored in plain text"; exit 1; }
[ "$(sql "select secret from settings where key = 'bot.google_session'")" = t ] || { echo "the session is not stored as a secret"; exit 1; }
api "$base/settings/bot/google-session" | grep -q fixture-session && { echo "the session was returned by the API"; exit 1; }
remote_sh "$compose exec -T web openminutes join '$(meet_url signed "$signed_query&signed=1")'"
result="$(wait_for "join_url like '%lookup/signed-%'")"
echo "signed-in meeting: $result"
[ "$result" = transcribed ] || { sql "select error from meetings where join_url like '%lookup/signed-%'"; exit 1; }
[ "$(fixture_events | jq '[.[] | select(.type == "joined" and .platform == "meet" and .signedIn == true and .name == "Bot Account")] | length')" -ge 1 ] || { echo "fixture did not see the bot join with its account"; exit 1; }
api -X PUT "$base/settings/bot/google-session" -d "$(session_state 1)" | jq -c .
[ "$(api "$base/settings/bot/google-session" | jq -r .status)" = expired ] || { echo "a session with old cookies is not expired"; exit 1; }
expect_failure "meet expired session" "$(meet_url expired 'lobby=500&leaveAfter=4000&expired=1')" 'The Google session of the bot expired, sign in again under Settings, Google Meet sign-in'
api -X DELETE "$base/settings/bot/google-session" | jq -c .
[ "$(api "$base/settings/bot/google-session" | jq -r .status)" = missing ] || { echo "the session was not removed"; exit 1; }

echo "== calendar connect and sync"
api() { curl -fs -b "$jar" -c "$jar" -H 'content-type: application/json' "$@"; }
fake() { curl -fs -X POST "$fake_url/_admin/$1" -d "$2" >/dev/null; }
in_seconds() { date -u -d "+$1 seconds" +%Y-%m-%dT%H:%M:%SZ; }
eventually() {
  for _ in $(seq 60); do
    [ "$(eval "$1")" = "$2" ] && return 0
    sleep 2
  done
  echo "timed out waiting for: $1 (expected $2, got $(eval "$1"))"
  return 1
}
account_id() { api "$base/accounts" | jq -r --arg p "$1" '[.accounts[] | select(.provider == $p)][0].id // empty'; }
calendar_count() { api "$base/accounts" | jq -r --arg p "$1" '[.accounts[] | select(.provider == $p)][0].calendars | length // 0'; }
primary_calendar() { api "$base/accounts" | jq -r --arg p "$1" '[.accounts[] | select(.provider == $p)][0].calendars[] | select(.isPrimary) | .id'; }

connect() {
  api -X PUT "$base/accounts/providers/$1" -d '{"clientId":"e2e-client","clientSecret":"e2e-secret"}' >/dev/null
  landing="$(curl -fsL -b "$jar" -c "$jar" -o /dev/null -w '%{url_effective}' "$base/oauth/$1/start")"
  echo "connect $1 landed on $landing"
  eventually "account_id $1 | grep -c ." 1
  api -X POST "$base/accounts/$(account_id "$1")/sync" >/dev/null
  eventually "calendar_count $1" 2
}

echo "-- google"
connect google
echo "account: $(api "$base/accounts" | jq -c '.accounts[0] | {email, provider}')"
fake events "{\"provider\":\"google\",\"event\":{\"id\":\"auto\",\"title\":\"Auto join\",\"start\":\"$(in_seconds 75)\",\"end\":\"$(in_seconds 900)\",\"conferenceUrl\":\"$(meet_url calflow 'lobby=2000&leaveAfter=12000')\"}}"
fake events "{\"provider\":\"google\",\"event\":{\"id\":\"moved\",\"title\":\"Moves later\",\"start\":\"$(in_seconds 7200)\",\"end\":\"$(in_seconds 9000)\",\"description\":\"<a href=\\\"https://www.google.com/url?q=https://meet.google.com/mov-edxx-yzz&amp;sa=D\\\">Join</a>\"}}"
echo "default rule keeps meetings out: $(sql "select count(*) from meeting_sources")"
api -X PUT "$base/accounts/calendars/$(primary_calendar google)" -d '{"joinRule":"all"}' >/dev/null
eventually "sql \"select count(*) from meeting_sources\"" 2
sql "select s.calendar_event_id, m.platform, m.status, m.join_url from meetings m join meeting_sources s on s.meeting_id = m.id order by 1"

echo "-- auto join of the calendar event"
result="$(wait_for "id = (select meeting_id from meeting_sources where calendar_event_id = 'auto')")"
echo "status: $result"
[ "$result" = transcribed ] || { remote_sh "$compose logs bot worker --tail 80"; exit 1; }
sql "select count(*) from audio_files where meeting_id = (select meeting_id from meeting_sources where calendar_event_id = 'auto')"

echo "-- reschedule and delete"
before="$(sql "select scheduled_start from meetings where id = (select meeting_id from meeting_sources where calendar_event_id = 'moved')")"
fake events "{\"provider\":\"google\",\"event\":{\"id\":\"moved\",\"title\":\"Moved\",\"start\":\"$(in_seconds 10800)\",\"end\":\"$(in_seconds 12600)\",\"conferenceUrl\":\"https://meet.google.com/mov-edxx-yzz\"}}"
api -X POST "$base/accounts/$(account_id google)/sync" >/dev/null
eventually "sql \"select title from meetings where id = (select meeting_id from meeting_sources where calendar_event_id = 'moved')\"" Moved
after="$(sql "select scheduled_start from meetings where id = (select meeting_id from meeting_sources where calendar_event_id = 'moved')")"
[ "$before" != "$after" ] || { echo "start time did not change"; exit 1; }
fake events/delete '{"provider":"google","id":"moved"}'
api -X POST "$base/accounts/$(account_id google)/sync" >/dev/null
eventually "sql \"select status from meetings where id = (select meeting_id from meeting_sources where calendar_event_id = 'moved')\"" cancelled

echo "-- microsoft"
connect microsoft
fake events "{\"provider\":\"microsoft\",\"event\":{\"id\":\"teams\",\"title\":\"Teams call\",\"start\":\"$(in_seconds 7200)\",\"end\":\"$(in_seconds 9000)\",\"conferenceUrl\":\"https://teams.microsoft.com/l/meetup-join/19%3ameeting_e2e%40thread.v2/0\"}}"
api -X PUT "$base/accounts/calendars/$(primary_calendar microsoft)" -d '{"joinRule":"all"}' >/dev/null
eventually "sql \"select platform from meetings where id = (select meeting_id from meeting_sources where calendar_event_id = 'teams')\"" teams

echo "-- disconnect"
api -X DELETE "$base/accounts/$(account_id microsoft)" >/dev/null
eventually "sql \"select status from meetings where title = 'Teams call'\"" cancelled

echo "== ok"
