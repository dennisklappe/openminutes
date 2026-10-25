# FAQ

## Product

### Does it work with Zoom?

No. Version 1 covers Google Meet and Microsoft Teams. Zoom and Webex are not planned for v1.

### Is it ready to use?

Early release (v0.1): expect breaking changes. The [roadmap](roadmap.md) shows what works and what is next.

### Is there a paid version?

Self-hosting is free, complete and needs no licence key. A hosted option exists if you would rather not run a server, see the hosting page on the website. Same software.

### Can I use it for phone calls or in-person meetings?

Yes, with the [phone recorder](phone-recorder.md). It records in the browser, also offline, and uploads when it can.

## Privacy and consent

### Does it send data anywhere?

Only where you point it: the transcription or summary provider you configure, or nowhere with local transcription and no summary. No telemetry, no account.

### Will the other participants know?

Yes. The bot joins under its own visible name and can post in the meeting chat. You are responsible for the consent rules that apply, see [consent and privacy](consent-and-legal.md).

## Running it

### What does it cost to run?

About 1 vCPU and 1.5 GB RAM per simultaneously recorded meeting, plus a small base for the web, worker and database containers. See [sizing](sizing.md).

### Do I need my own Google and Microsoft apps?

Only for calendar auto-join: a [Google OAuth client](google-oauth.md) and an [Azure app registration](azure-app.md). Pasting a meeting link needs neither.

### Do I need a public address?

Calendar sign-in needs a hostname you control, ideally behind HTTPS. See [reverse proxy and HTTPS](reverse-proxy.md).

### Why does Google Meet refuse the bot?

Meet can refuse signed-out guests from automated browsers. Give the bot its own Google account, see [signing the Meet bot in](meet-sign-in.md).

### Which transcription providers can I use?

Local faster-whisper (no key), or OpenAI, Groq, Deepgram and AssemblyAI with yours. See [providers](providers.md).
