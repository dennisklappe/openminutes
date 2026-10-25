# Status and roadmap

v0.1.0 is out. Progress is tracked on [GitHub](https://github.com/dennisklappe/openminutes).

## Roadmap to v0.1

1. **Walking skeleton:** paste a Meet link, the bot joins, records and stores audio.
2. **Transcripts:** provider interface, OpenAI and local Whisper, a meeting detail page.
3. **Speakers:** reading speakers from Meet, alignment, a speaker-coloured transcript. Reading and alignment are in; page selectors are not yet verified against a live call.
4. **Teams:** platform module, guest join, speakers. See [Microsoft Teams](teams.md).
5. **Calendar:** Google then Microsoft, join rules, auto-join.
6. **Summaries:** OpenAI-compatible and Anthropic providers, prompt templates, regenerate, long meetings summarised in parts.
7. **Polish:** setup wizard, Test buttons, S3 storage, retention, slim and local images, docs, v0.1 release. Wizard, storage, retention, meeting search, delete and the concurrency limit are in.
8. **Bot name, avatar and join message (free):** set the bot name, camera image and join message.

## Not in version 1

- Zoom and Webex.
- Live captions in the UI.
- Joining meetings that block guests (the reason is reported instead).
- A hosted service.
- Multiple users.

Known risks: see [design](design.md#known-risks).
