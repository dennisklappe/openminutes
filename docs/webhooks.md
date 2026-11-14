# Webhooks

A webhook sends a small signed message to another service when something happens to a meeting. Use it to post a link in a chat, start a script, or keep another system in step, without polling the API.

Webhooks are managed in the app under Settings, API, Webhooks. They need a signed-in session: an API key cannot create or change them, see [the API guide](api.md).

## Set one up

1. Open Settings, API, Webhooks and choose Add webhook.
2. Enter a name, the address that should receive the events, and tick the events you want.
3. Optionally narrow it with filters, see [Filters](#filters).
4. Copy the signing secret. It starts with `whsec_` and is shown once.
5. Choose Send test ping. A delivery with the status Delivered means your service answered with a 2xx code.

## Events

| Event                          | Sent when                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `meeting.transcribed`          | The transcript is ready. Also sent again if you rerun a meeting and it ends transcribed again.              |
| `meeting.summarized`           | An AI summary finished. Manual edits to a summary do not send it.                                           |
| `meeting.deleted`              | A meeting was moved to the bin, or removed for good without ever being in the bin. Once per meeting.        |
| `meeting.participants_updated` | Participants or speaker names changed. The payload has the current list. Quick edits are sent as one event. |
| `meeting.updated`              | The title changed.                                                                                          |
| `webhook.test`                 | You chose Send test ping. It has a made up sample meeting.                                                  |

`meeting.participants_updated` is for the case where you assign speaker names after the meeting. A receiver that decided something on the first `meeting.transcribed` (for example "no known client in this meeting") can look at the new list and decide again.

Delivery is at least once. The same event can arrive twice, for example after a rerun or a retry, so the receiver must ignore an event id it has already handled.

## Payload

The body is JSON. It never contains the transcript or the summary text: fetch those with the [API](api.md) if you need them.

```json
{
  "id": "6f1c2c1e-0a5b-4c58-9d1f-2f6a4d0f6c11",
  "event": "meeting.transcribed",
  "occurredAt": "2026-03-04T10:31:07.000Z",
  "meeting": {
    "id": "0b8a5d0e-3a43-4f0c-8c33-7f0b5a0c9f10",
    "title": "Acme weekly",
    "startedAt": "2026-03-04T09:00:02.000Z",
    "endedAt": "2026-03-04T09:47:31.000Z",
    "durationSeconds": 2849,
    "participants": ["Sam Jones", "Priya Patel"],
    "status": "transcribed",
    "company": "Acme",
    "platform": "meet"
  }
}
```

- `id` is the event id. A retry or a replay of the same event keeps it.
- `participants` holds display names only, no email addresses. It is left out when there are none.
- `company` is `null` when the meeting has no company.
- `platform` is `meet`, `teams`, `recording` or `imported`.

## Headers

| Header                    | Value                                              |
| ------------------------- | -------------------------------------------------- |
| `Content-Type`            | `application/json`                                 |
| `User-Agent`              | `OpenMinutes-Webhooks/<version>`                   |
| `X-OpenMinutes-Event`     | The event name, for example `meeting.transcribed`. |
| `X-OpenMinutes-Delivery`  | The id of this delivery.                           |
| `X-OpenMinutes-Event-Id`  | The event id, the same as `id` in the body.        |
| `X-OpenMinutes-Signature` | `t=<unix seconds>,v1=<hex signature>`              |

## Check the signature

Always check it. Anyone who knows your address could otherwise send you fake events.

The signature is an HMAC-SHA256, in lower case hex, of the text `<t>.<raw body>`: the timestamp from the header, a dot, and the exact bytes of the body as received. The key is your signing secret, the whole string including `whsec_`. Each attempt gets a new timestamp and signature.

Check against the raw body, before any JSON parsing. A parsed and re-serialized body is not byte for byte the same.

Then do three things:

1. Compute the signature and compare it with `v1` in constant time.
2. Reject the request when `t` is more than 5 minutes away from your clock, in either direction. This stops someone replaying a captured request later.
3. Remember the event id for a while and ignore one you have seen.

### Node

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 5 * 60;

export function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const given = Buffer.from(parts.v1, 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

// Express: keep the raw body, for example express.raw({ type: 'application/json' })
// app.post('/openminutes', express.raw({ type: 'application/json' }), (req, res) => {
//   const ok = verify(req.body.toString('utf8'), req.get('X-OpenMinutes-Signature') ?? '', SECRET);
//   if (!ok) return res.sendStatus(400);
//   const event = JSON.parse(req.body.toString('utf8'));
//   // ignore event.id when you have seen it, then do your work
//   res.sendStatus(204);
// });
```

### Python

```python
import hashlib
import hmac
import time

TOLERANCE_SECONDS = 5 * 60


def verify(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.strip().split("=", 1) for p in header.split(","))
    try:
        t = int(parts["t"])
        given = parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > TOLERANCE_SECONDS:
        return False
    signed = f"{t}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, given)
```

In Flask use `request.get_data()` for `raw_body`, in FastAPI `await request.body()`.

### Bash and openssl

Handy to try a captured request by hand. Save the body to `body.json` exactly as received (no trailing newline added).

```bash
SECRET='whsec_...'
HEADER='t=1772618400,v1=...'   # the X-OpenMinutes-Signature value

T=$(echo "$HEADER" | sed -E 's/.*t=([0-9]+).*/\1/')
GIVEN=$(echo "$HEADER" | sed -E 's/.*v1=([0-9a-f]+).*/\1/')
EXPECTED=$( { printf '%s.' "$T"; cat body.json; } | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')

[ "$EXPECTED" = "$GIVEN" ] && echo valid || echo invalid
NOW=$(date +%s); [ $(( NOW - T )) -lt 300 ] && [ $(( T - NOW )) -lt 300 ] || echo "too old"
```

## Answer quickly

Answer with any 2xx status within 10 seconds. The body of your answer is ignored (the first 2 KB is kept in the log for debugging). Do slow work after you answered, for example by putting the event on a queue. Redirects are not followed: a 301 or 302 counts as a failure, so use the final address.

## Retries and failures

A delivery that does not get a 2xx answer is tried again. There are at most 6 attempts, waiting 30 seconds, 2 minutes, 10 minutes, 1 hour and 6 hours between them. After the sixth the delivery is given up (shown as Gave up).

| Attempt | Wait before it |
| ------- | -------------- |
| 1       | right away     |
| 2       | 30 seconds     |
| 3       | 2 minutes      |
| 4       | 10 minutes     |
| 5       | 1 hour         |
| 6       | 6 hours        |

A webhook is turned off automatically after 10 deliveries in a row were given up. It shows as Disabled with the reason. Fix the receiver and turn it on again from the list (Turn on, or Edit and tick Active). That clears the counter.

The badge in the list means:

| Badge             | Meaning                                                 |
| ----------------- | ------------------------------------------------------- |
| Healthy           | The last delivery worked.                               |
| Retrying          | A delivery is being retried or the last attempt failed. |
| Failing           | The last three deliveries were given up.                |
| Disabled          | Paused by you, or turned off after too many failures.   |
| No deliveries yet | Nothing was sent so far.                                |

If OpenMinutes restarts while a delivery is being sent, it is picked up again afterwards. Nothing is lost.

## Filters

Filters decide per meeting whether a webhook gets an event. A meeting that does not match gets no delivery at all, so it does not show in the log either. With no filters, every meeting is sent.

| Filter                 | Matches when                                                           |
| ---------------------- | ---------------------------------------------------------------------- |
| Title contains         | The title has any of the lines as a piece of text.                     |
| Title does not contain | The title has none of the lines.                                       |
| A participant contains | Any participant name or email has any of the lines as a piece of text. |
| Company is             | The meeting company is exactly one of the lines.                       |
| Platform               | The meeting is on one of the ticked platforms.                         |

Upper and lower case never matter. Inside one filter, any line is enough. Between filters, all must match. The filters are checked against the data in the payload, plus the participant email addresses, which are only used for matching and never sent.

Examples:

- Only client calls: Title contains `client`, Title does not contain `internal`.
- Everything with people from one customer: A participant contains `@acme.com`.
- Only meetings in Google Meet or Teams: tick those two platforms.
- Only for one company: Company is `Acme`.

Filters apply to `meeting.deleted` too, and to every other event.

## Addresses that are allowed

OpenMinutes sends from your own server, so a webhook must not be able to reach things it should not. The address is checked when you save it and again at every delivery. The name is looked up, every address it resolves to is checked, and the connection goes to the address that was checked, so a name that changes between the check and the call does not help.

- The address must be `https://`, without a username or password. Any port is fine.
- Never allowed: link-local addresses (`169.254.x.x`, `fe80::/10`, where cloud metadata services live), `0.0.0.0`, multicast, and IPv4 addresses written in IPv6 form.
- Blocked unless you tick Allow private addresses and plain http: loopback (`127.x`, `::1`), private networks (`10.x`, `172.16.x` to `172.31.x`, `192.168.x`), the carrier range `100.64.0.0/10` and `fc00::/7`.

Tick Allow private addresses for a service on your own network, such as n8n, Node-RED or Home Assistant. Then `http://` also works. The app shows a warning, because the webhook can then reach any machine your OpenMinutes server can reach. Turn it on per webhook, only for addresses you trust. There is no setting that allows it everywhere.

## Secret rotation

Choose Rotate secret in the list to get a new signing secret. The old secret stops working at once, and the new one is shown once. Update your receiver right away, or deliveries in between fail and are retried (retries are signed with the new secret, so they succeed once the receiver is updated, if you are within the retry window).

OpenMinutes keeps the secret encrypted. It cannot show it again, and only the first characters are shown in the list so you can tell secrets apart.

## Test, replay and the delivery log

- Send test ping sends a `webhook.test` event with a made up meeting (title "Test event from OpenMinutes").
- Send test event sends a real event shape for one of your meetings, so your receiver sees real ids. Pick the event and optionally a meeting id. Without an id it uses your latest transcribed meeting. Filters are ignored, and it is marked Test in the log.
- Deliveries opens the log: status, event, the number of attempts, the last HTTP status and error, the time, and the exact payload that was sent. Filter by status. The list updates by itself while it is open. Entries are kept for 30 days.
- Replay sends a delivery again as a new entry marked Replay, with the same payload and event id and a fresh signature. The original stays in the log. Your receiver should treat it as a duplicate, which is the point of the event id.

## Recipes

These work with any tool that can receive an HTTP request: n8n, Zapier, Make, Node-RED, a small script, or a serverless function. Always verify the signature in your own code, or in the tool when it supports it.

### Post a summary link in a chat or inbox

Subscribe to `meeting.summarized`. The payload has the meeting id, so build the link yourself and post it:

```js
const link = `https://minutes.example.com/meetings/${event.meeting.id}`;
await postToChat(`Summary ready for "${event.meeting.title}": ${link}`);
```

If you want the summary text in the message, fetch it with an API key, see [the API guide](api.md#the-latest-summary-and-its-markdown). Add a Company is filter to send each customer's meetings to their own channel, using one webhook per channel.

### Start a time tracking or billing script

Subscribe to `meeting.transcribed` and set Title contains to `[billable]` (or whatever marker your team puts in billable meeting titles). The script gets the duration without any polling:

```js
const hours = Math.round((event.meeting.durationSeconds / 3600) * 4) / 4;
await addTimeEntry({ client: event.meeting.company, hours, note: event.meeting.title });
```

Use the event id to avoid booking the same meeting twice, since a rerun sends the event again. Also subscribe to `meeting.deleted` to undo the entry.

### Decide again when names are known

Subscribe to `meeting.participants_updated` next to `meeting.transcribed`. When you give speakers their names after the meeting, the event arrives with the current list, and your receiver can run its rules again, for example "does this meeting include someone from Acme".

### Keep another system in step with renames

Subscribe to `meeting.updated` and update the title in the other system. The payload has the new title.

## Security notes

- Verify the signature and the timestamp on every request, and keep the secret out of source control and logs.
- Use https. Only allow private addresses or http for a service you run yourself, on a network you trust.
- Payloads hold meeting titles, company names and participant names. Treat the receiving service as holding personal data, see [consent and privacy](consent-and-legal.md).
- Answer with a 2xx only after you stored or queued the event, so a crash on your side leads to a retry rather than a lost event.
- Webhooks can only be managed with a signed-in session. API keys cannot create, read or change them, so a leaked API key cannot redirect your events.
