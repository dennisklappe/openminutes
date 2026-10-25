# Configuration

Almost everything lives in the Settings page (stored in Postgres). The environment holds only what is needed to start and decrypt.

## Environment

| Variable                         | Required                 | Purpose                                                                                                                                                                               |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENMINUTES_SECRET`             | Yes                      | Encrypts stored secrets and OAuth tokens. Use a long random value and keep it.                                                                                                        |
| `OPENMINUTES_TAG`                | No                       | Release line to run, default `0.1`. See [upgrading](upgrading.md).                                                                                                                    |
| `OPENMINUTES_PORT`               | No                       | Port the web UI is published on, default `3000`.                                                                                                                                      |
| `TZ`                             | No                       | Timezone for minutes, an IANA name such as `Europe/Amsterdam`. Default `UTC`. Settings, General, Timezone overrides it, and the setup wizard fills that in from your browser.         |
| `POSTGRES_PASSWORD`              | No                       | Password of the bundled database, default `openminutes`. Only reachable inside the compose network.                                                                                   |
| `OPENMINUTES_PUBLIC_URL`         | No                       | Public base URL, such as `https://openminutes.example.com`. Builds the OAuth redirect URIs. Set it behind a reverse proxy that changes host or scheme, else derived from the request. |
| `OPENMINUTES_AUTH`               | No                       | `password` (default) or `cloudflare-access`. See [Cloudflare Access](#cloudflare-access) and the [setup steps](reverse-proxy.md#cloudflare-access-sign-in-by-cloudflare).             |
| `OPENMINUTES_ACCESS_TEAM_DOMAIN` | With `cloudflare-access` | Your Zero Trust team domain, such as `example.cloudflareaccess.com`.                                                                                                                  |
| `OPENMINUTES_ACCESS_AUD`         | With `cloudflare-access` | Application Audience (AUD) tag of the Access application.                                                                                                                             |
| `OPENMINUTES_ACCESS_EMAILS`      | No                       | Comma separated email allow-list. Default: any email Access lets through.                                                                                                             |

`compose.yaml` sets the database connection and lists all defaults.

## Settings in the UI

Every card that edits values works the same way: change it, then press Save changes (off until you change something). Nothing saves by itself. Buttons such as Test connection, Connect or Forget act at once and are not a save.

| Section               | What is in it                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| General               | Appearance, Timezone, Meeting limits, Setup wizard                                                                                      |
| Bot identity          | Display name, join chat message, camera image, see [bot identity](bot-identity.md)                                                      |
| Minutes               | Template, logo, Include defaults, destinations, export and calendar link, see [minutes](minutes.md)                                     |
| Email                 | Provider, sender, test mail, see [email](email.md)                                                                                      |
| Calendar accounts     | Google and Microsoft calendars, join rule per calendar, skipped series                                                                  |
| Google Meet sign-in   | Dedicated Google account for the bot, see [Meet bot account](meet-sign-in.md)                                                           |
| Phone recorder        | On or off, consent text, see [phone recorder](phone-recorder.md)                                                                        |
| Transcription         | Provider, keys, language, Test, see [providers](providers.md)                                                                           |
| Summaries             | Provider and model, Speaker names (`speakers.refine`), People, Recognise voices, Meeting chat (`summary.include_chat`), Summary prompts |
| Storage and retention | Local volume or S3, days to keep audio, see [storage](storage.md)                                                                       |
| Access and updates    | Password or Cloudflare Access, update notice                                                                                            |

Meeting limits: lobby wait (default 10 minutes), alone time (60 seconds), longest stay (4 hours), simultaneous recordings (default 1, up to 10, see [sizing](sizing.md)). Calendars are polled every 2 minutes for the next 14 days. A join rule is all meetings, only ones you organise, only ones with external guests, or never. New calendars start on Never. Redirect URIs: `/api/oauth/google/callback` and `/api/oauth/microsoft/callback`. Skipped series: see [meeting lifecycle](meeting-lifecycle.md).

## Cloudflare Access

Set `OPENMINUTES_AUTH=cloudflare-access` with the team domain and AUD tag instead of an app password. Setup steps: [reverse proxy](reverse-proxy.md#cloudflare-access-sign-in-by-cloudflare).

- Every request needs a valid `Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie. The RS256 signature, issuer, audience, expiry and an email are checked. The plain email header is never trusted.
- Failures get a 401, except `GET /`: a redirect to the project page. `GET /login` redirects to `/`.
- No password and no password step in the wizard. Only `/api/version` stays open.
- Share links under `/s/*` need a bypass policy, see [share links](reverse-proxy.md#let-s-through).
- It refuses to start when the team domain or AUD tag is missing.

> [!TIP]
> Keep the origin reachable only through Cloudflare (a Tunnel, no published port).

## Sign-in protection

Password mode only. Ten wrong passwords from one address within 15 minutes lock it out. Behind a proxy everyone shares one address: restart the web container to clear it.

## Backups

Back up the Postgres database, the audio volume (or bucket) and `OPENMINUTES_SECRET`. All three are needed to restore. Commands: [upgrading](upgrading.md#back-up-first).

## Image variants

Four images share one version tag: `openminutes-web`, `openminutes-worker`, `openminutes-bot` and `openminutes-whisper`.

- Slim (default): web, worker and bot, cloud transcription providers only. Started by `docker compose up -d`.
- Local: adds `openminutes-whisper` (faster-whisper), so transcription needs no key. Start with `docker compose --profile local up -d`.
