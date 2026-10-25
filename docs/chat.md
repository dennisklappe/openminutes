# Meeting chat

The bot reads the chat of Google Meet and Teams meetings and keeps it next to the transcript, so "I will send the link in the chat" is not lost.

## What is captured

- Every message others post while the bot is present: sender, text and links.
- Only http and https count as links; `javascript:`, `mailto:`, `ftp:` stay plain text.
- The bot's own messages (such as its join message) are left out.
- Messages from before it joined are not shown by Meet or Teams, so not captured.

The bot opens the chat panel after joining and reads it about every 2 seconds. Messages are stamped with when they were first seen, so they line up with the transcript. Saves happen every 30 seconds, so a crash loses at most half a minute. If the selectors stop matching, the meeting records without chat.

## Where it shows up

- **Meeting page**: chat bubbles between transcript segments. Click one to jump the audio. "Show chat" above the transcript (on by default, remembered in the browser) hides them.
- **Transcript exports** (`transcript.md`, `transcript.json`): interleaved by time in Markdown, under `chat` in JSON.
- **Minutes** (share links, HTML, Markdown, Word, Google Docs, OneDrive, email): a Chat tab or section of its own, when you tick Chat under Include on the Minutes card. Settings, Minutes, Include the chat by default (`minutes.include_chat`, off by default) sets the starting state. The transcript is not needed.
- **Summary**: with `summary.include_chat` (on by default) the model gets a `## Chat messages` block and lists shared links under Resources, without retelling the chat.

Deleting a meeting deletes its chat.

## Limits

- Selectors were written from knowledge of the pages and tested on hand written fixtures, not a live call. If chat stops being captured, re-record them, see `packages/platforms/fixtures/`.
- Platforms show a minute label only, so first-seen time orders messages, a few seconds late.
- Reactions, attachments and edits are not captured; an edited message keeps the first text seen.

> [!WARNING]
> Chat can hold personal or confidential details. [Consent and legal](consent-and-legal.md) applies.
