# API

Everything the app does goes through a JSON API on the same address as the app. Other services can use it with an API key: read transcripts and summaries, edit them, manage people and meetings, join a meeting by link.

> [!NOTE]
> The API is the one the app itself uses, so it follows the app and may change between minor versions until 1.0. The endpoints in this page are the exceptions: they stay stable. Anything else in the [endpoint reference](api-reference.md) can change, so pin your OpenMinutes version if you depend on it.

## Create a key

Open Settings, API, press Create key, name it, pick Read only or Full and an expiry. The key is shown once. OpenMinutes stores only a fingerprint (sha256), so a lost key cannot be recovered: revoke it and create a new one.

A key looks like `omk_` followed by 43 characters. Treat it like a password and keep it out of git.

```bash
export OM=https://openminutes.example.com
export KEY=omk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Authentication

Send the key in the `Authorization` header of every request:

```bash
curl -H "Authorization: Bearer $KEY" "$OM/api/meetings"
```

- A request with a key is judged on the key alone. A session cookie sent along is ignored, and a bad key is a 401 even with a valid cookie.
- Requests with a key skip the browser origin check, so no `Origin` header is needed.
- Unknown, revoked and expired keys all get the same `401 {"error":"Invalid API key"}`.
- Behind Cloudflare Access, the request must still get past Access at the edge: add a service token or a bypass rule for `/api/*` there. See [reverse proxy](reverse-proxy.md#cloudflare-access-sign-in-by-cloudflare).

## Scopes

| Scope     | Can do                                                        |
| --------- | ------------------------------------------------------------- |
| Read only | `GET` and `HEAD` requests. Any other method is a 403.         |
| Full      | Everything the app can do, except what no key can do (below). |

No key, whatever its scope, can use:

- API key management (`/api/settings/api-keys`): keys cannot create or revoke keys.
- Connected accounts and sign-in (`/api/accounts`, `/api/oauth`, `/api/setup`, `/api/login`, `/api/logout`). There is no endpoint to change the admin password.

These answer `403 {"error":"An API key cannot use this endpoint"}`. Secret values such as provider keys are masked in every settings response, for sessions and keys alike.

## Rate limit

600 requests per minute per key. Over that, the answer is `429` with a `Retry-After` header in seconds.

## Errors

Errors are JSON with an `error` message and the usual status code:

| Status | Meaning                                                                                     |
| ------ | ------------------------------------------------------------------------------------------- |
| 400    | The body or a parameter is invalid.                                                         |
| 401    | Missing, unknown, revoked or expired key.                                                   |
| 403    | A read key tried to write, or the endpoint is closed to keys.                               |
| 404    | The meeting, person or other item does not exist.                                           |
| 409    | The request conflicts with the current state, for example a meeting that is already joined. |
| 413    | The body is too large (4 MiB, chunk uploads have their own limit).                          |
| 429    | Rate limit, see `Retry-After`.                                                              |

## Common tasks

Stable endpoints. Types of the responses are in `apps/web/src/dto.ts`.

| Task                          | Call                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| List meetings                 | `GET /api/meetings`, filters `q`, `platform`, `status`, `scope=archived\|bin`                       |
| Get a meeting with transcript | `GET /api/meetings/:id`                                                                             |
| Transcript as Markdown / JSON | `GET /api/meetings/:id/transcript.md`, `transcript.json`                                            |
| Latest summary                | `summaries` in `GET /api/meetings/:id`, the entry with `active: true`                               |
| Edit the summary text         | `POST /api/meetings/:id/summaries/edit` `{content}`                                                 |
| Rename a speaker (voice)      | `PUT /api/meetings/:id/voices/:participantId` `{name}`                                              |
| List people                   | `GET /api/people`                                                                                   |
| Merge people                  | `POST /api/people/:id/merge` `{sourceId}`                                                           |
| Join a meeting by link        | `POST /api/meetings` `{url, title?}`                                                                |
| Export to a destination       | `POST /api/meetings/:id/export/:exporterId`                                                         |
| Import recordings             | `PUT /api/imports/:id/chunks/:index`, `POST /api/imports/:id/finish`, `POST /api/imports/:id/start` |

### List meetings

```bash
curl -H "Authorization: Bearer $KEY" "$OM/api/meetings?status=transcribed&q=planning"
```

### Get a meeting with its transcript

`segments` holds the transcript lines with speaker and time, `summaries` every summary version, `chat` the meeting chat.

```bash
curl -H "Authorization: Bearer $KEY" "$OM/api/meetings/$ID" | jq '.segments[:3]'
```

### The latest summary and its Markdown

The active summary is the one the app shows. Its `content` is Markdown.

```bash
curl -s -H "Authorization: Bearer $KEY" "$OM/api/meetings/$ID" \
  | jq -r '.summaries | map(select(.active and .status == "done")) | first | .content'
```

The whole transcript with the summary on top, as one Markdown file:

```bash
curl -H "Authorization: Bearer $KEY" "$OM/api/meetings/$ID/transcript.md" -o meeting.md
```

### Export

`GET /api/exporters` lists the destinations. Without a body the export uses the Minutes settings.

```bash
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"includeTranscript": true}' "$OM/api/meetings/$ID/export/$EXPORTER"
```

`GET /api/meetings/:id/minutes` returns the rendered minutes as an HTML page.

### Edit a summary

This adds a new summary version with your text, like Save in the app. It needs a full key, answers 201, and 409 while a summary is still being generated.

```bash
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"content": "## Decisions\n\n- Ship on Friday"}' "$OM/api/meetings/$ID/summaries/edit"
```

### Rename a speaker

`GET /api/meetings/:id/voices` lists the voices with their ids.

```bash
curl -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name": "Alex Example"}' "$OM/api/meetings/$ID/voices/$VOICE"
```

### List and merge people

```bash
curl -H "Authorization: Bearer $KEY" "$OM/api/people?q=alex"
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"sourceId": "'"$DUPLICATE"'"}' "$OM/api/people/$KEEP/merge"
```

`sourceId` is merged into the person in the path and then removed.

### Join a meeting by link

Google Meet and Microsoft Teams links. 409 with `duplicateOf` when the meeting already exists.

```bash
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"url": "https://meet.google.com/abc-defg-hij", "title": "Weekly sync"}' "$OM/api/meetings"
```

### Start a recording import

An import takes a Fireflies data export. Upload the archive in chunks under an id you choose (a UUID), finish, look at the preview, then start the meetings you want. See [import from Fireflies](import-fireflies.md) for the limits.

```bash
ID=$(uuidgen)
curl -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/octet-stream" \
  --data-binary @chunk-0.bin "$OM/api/imports/$ID/chunks/0"
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"chunks": 1}' "$OM/api/imports/$ID/finish"
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"keys": ["<fireflies meeting id from the preview>"]}' "$OM/api/imports/$ID/start"
```

To upload a recording from a device instead, see the [phone recorder API](phone-recorder-api.md).

## All endpoints

[API endpoint reference](api-reference.md) lists every method and path, generated from the routes, and which key can call it. Request bodies are checked by each route; the TypeScript types in `apps/web/src/dto.ts` describe them.
