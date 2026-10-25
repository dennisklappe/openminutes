# Reverse proxy and HTTPS

Time: about 15 minutes.

Google sign-in, the phone recorder and phone install need HTTPS on a real hostname. OpenMinutes speaks plain HTTP on port 3000, so put a proxy in front.

| Option            | Use it when                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Caddy             | You have a server with a public IP and a DNS name. Certificates are automatic.            |
| Cloudflare Tunnel | No open ports, or you want Cloudflare Access to sign people in.                           |
| Tailscale         | Only you and your devices use it. `tailscale serve` gives a valid `*.ts.net` certificate. |

## What the proxy must do

- Pass `Host` and `X-Forwarded-Proto: https`. OpenMinutes builds the OAuth redirect URI from them and marks its sign-in cookie secure only on `https`. Caddy and Cloudflare Tunnel do this by default.
- Or set `OPENMINUTES_PUBLIC_URL=https://openminutes.example.com` in `.env` and run `docker compose up -d`. Then nothing depends on the headers.
- Allow uploads of a few MB. Phone recordings arrive in small chunks, so defaults are fine.

## Before you expose it

- The first person to open a fresh install sets the admin password. Create it right after the first start, and keep the port closed or bound to localhost until you have.
- Set `OPENMINUTES_PUBLIC_URL`. Share links and OAuth redirects are then built from it and not from request headers.
- A shareable link shows the minutes to anyone who has the URL. Revoke it in the share dialog. Moving a meeting to the bin revokes its links.
- The bot opens meeting pages in Chromium without Chromium's own sandbox, because Docker's default profile blocks it. The container is the boundary, so do not add the Docker socket or extra mounts to the `bot` service.
- The database is only reachable inside the compose network. If you publish port 5432, set a real `POSTGRES_PASSWORD` first.

## Option 1: Caddy

1. Point a DNS `A` record for `openminutes.example.com` at your server and open ports 80 and 443.
2. Install [Caddy](https://caddyserver.com/docs/install) and put this in `/etc/caddy/Caddyfile`:

   ```
   openminutes.example.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```

3. `sudo systemctl reload caddy`. Caddy fetches the certificate itself.
4. Optional: publish OpenMinutes only on localhost by changing the port line in `compose.yaml` to `'127.0.0.1:${OPENMINUTES_PORT:-3000}:3000'`.
5. Open `https://openminutes.example.com`. The Google redirect URI is `https://openminutes.example.com/api/oauth/google/callback`.

> [!NOTE]
> No certificate means ports 80 or 443 are closed or DNS does not point at the server yet (`journalctl -u caddy`).

## Option 2: Cloudflare Tunnel

1. In Cloudflare, Zero Trust, Networks, Tunnels, create a tunnel and copy its token.
2. Add the connector to a `compose.override.yaml`:

   ```yaml
   services:
     cloudflared:
       image: cloudflare/cloudflared:latest
       restart: unless-stopped
       command: tunnel --no-autoupdate run
       environment:
         TUNNEL_TOKEN: ${CLOUDFLARED_TOKEN}
   ```

   Put `CLOUDFLARED_TOKEN=...` in `.env`.

3. In the tunnel, add a public hostname: `openminutes.example.com`, service type HTTP, URL `web:3000`.
4. To make Cloudflare the only way in, delete the `ports` lines of the `web` service in `compose.yaml`, or bind them to localhost as in the Caddy option.
5. Open `https://openminutes.example.com`.

> [!NOTE]
> Error 502 means a wrong URL: use `web:3000` when `cloudflared` runs in the same compose project, `localhost:3000` when it runs on the host.

## Cloudflare Access (sign-in by Cloudflare)

Let Cloudflare Access sign people in instead of an app password. Set up the tunnel first.

1. Zero Trust, Access, Applications, Add an application, Self-hosted. Application domain `openminutes.example.com`.
2. Add a policy with action Allow and your email (or team) under Include.
3. Save. On the application's Overview, copy the Application Audience (AUD) tag. The team domain is under Zero Trust, Settings, Custom Pages (like `example.cloudflareaccess.com`).
4. Add to `.env` (the last line is optional: without it any email Access lets through is accepted):

   ```
   OPENMINUTES_AUTH=cloudflare-access
   OPENMINUTES_ACCESS_TEAM_DOMAIN=example.cloudflareaccess.com
   OPENMINUTES_ACCESS_AUD=<the AUD tag>
   OPENMINUTES_ACCESS_EMAILS=you@example.com
   ```

5. `docker compose up -d`. No password is asked, and your email shows in the header.
6. Let share links through, see below.

### Let `/s/*` through

Share links need no login in OpenMinutes, but Access makes every visitor sign in. Add a second application so that path bypasses it. Access picks the most specific path, so the rest stays protected.

1. Zero Trust, Access, Applications, Add an application, Self-hosted.
2. Name `OpenMinutes share links`, domain `openminutes.example.com`, path `s/*`.
3. Add a policy `Public share links`, action **Bypass**, Include Everyone. Save.

Check without cookies: `curl -si https://openminutes.example.com/s/test` gives `404` ("This link is not available"), not a login redirect. `/api` still needs a token.

How the check works and what stays open: [configuration](configuration.md#cloudflare-access). OpenMinutes refuses to start in this mode when the team domain or AUD tag is missing.

> [!NOTE]
> 401 on every page: the AUD tag or team domain does not match the application. A redirect to the project page: the request had no Access token, so you reached the origin directly instead of through Cloudflare.

## Sign-in lockout behind a proxy

In password mode ten wrong passwords lock one address out for 15 minutes. Behind a proxy that hits everyone: restart the `web` container to clear it.
