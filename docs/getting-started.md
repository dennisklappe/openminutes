# Getting started

Time: about 10 minutes, plus the image download.

> [!NOTE]
> Early release (v0.1): expect breaking changes. The [roadmap](roadmap.md) says what works today.

## What you need

- Docker with the Compose plugin. See [sizing](sizing.md).
- For calendar sign-in or the phone recorder: a hostname with HTTPS, see [reverse proxy and HTTPS](reverse-proxy.md). For a first look, `http://localhost:3000` is enough.
- Optional: your own [Google](google-oauth.md) or [Azure](azure-app.md) app for calendar auto-join. Pasting a meeting link needs neither.
- Optional: a [transcription or summary provider](providers.md) key.

## 1. Start it

```bash
curl -O https://raw.githubusercontent.com/dennisklappe/openminutes/main/compose.yaml
echo "OPENMINUTES_SECRET=$(openssl rand -hex 32)" > .env
docker compose pull
docker compose up -d
```

For the bundled local transcriber (no key needed), use `docker compose --profile local up -d`.

> [!IMPORTANT]
> `OPENMINUTES_SECRET` encrypts every stored key and token. Back up `.env`: without it the secrets cannot be read.

More options: [.env.example](../.env.example) and [configuration](configuration.md).

## 2. Check that it runs

```bash
docker compose ps
curl http://localhost:3000/api/version
```

`web`, `worker`, `bot` and `db` should be running, and the second command prints the version. Open `http://localhost:3000` (or your `OPENMINUTES_PORT`).

## 3. Run the setup wizard

The wizard remembers your place. Skip setup leaves it, Settings, General, Open the setup wizard reopens it.

1. Password: choose an admin password of 10 characters or more and press Create admin. It is the only account.
2. Transcription: Local (faster-whisper) is the default and needs `--profile local` from step 1. For a hosted provider, pick it, paste the API key, press Test connection, then Save changes. Costs: [providers](providers.md).
3. Summaries: optional, leave on None to skip.
4. Calendar: optional. Paste the credentials from the [Google](google-oauth.md) or [Azure](azure-app.md) guide, press Save changes, then Connect Google or Connect Microsoft. New calendars start on Never: pick a join rule per calendar.
5. The bot: name, join message, meeting limits. Defaults work.
6. Storage and retention: local volume or S3-compatible bucket, and how long audio is kept. See [storage](storage.md).
7. Finish: the Join meeting box sends the bot into a meeting straight away, Open OpenMinutes closes the wizard.

## 4. Record a meeting

Paste a Google Meet or Teams link into the Join meeting box. The bot joins as OpenMinutes Notetaker and waits in the lobby: admit it. When the meeting ends it transcribes the audio and shows the transcript on the meeting page.

- Google Meet usually refuses server guests: set up [the Meet bot account](meet-sign-in.md) first.
- Teams guests work unless the organiser's tenant blocks them, see [Teams](teams.md).
- Tell people they are recorded, see the [consent and legal notes](consent-and-legal.md).

## If it fails

- `Set OPENMINUTES_SECRET in .env`: the `.env` file is missing or not next to `compose.yaml`.
- Port 3000 taken: set `OPENMINUTES_PORT=3001` in `.env` and run `docker compose up -d` again.
- Page does not load: `docker compose logs web --tail 50`.
- Test connection fails or the transcript errors: see [troubleshooting](troubleshooting.md).

## Next steps

- [Reverse proxy and HTTPS](reverse-proxy.md), needed for calendar sign-in and the phone recorder.
- [Email sending](email.md), [phone recorder](phone-recorder.md), [updating and backups](upgrading.md).
