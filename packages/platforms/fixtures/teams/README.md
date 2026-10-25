# Teams fixtures

Static pages that stand in for the Microsoft Teams web app in tests and in the Docker e2e run.

They are modelled on knowledge of how the Teams web client is built (the `data-tid` attributes, the launcher, pre-join, lobby and in-meeting screens). They are not recordings of a live meeting, and no real Teams tenant was available when they were written. Every selector in `src/teams-selectors.ts` is a best effort until it has been checked against a live meeting. When you can, replace these pages with real captured DOM and fix the selectors.

| Page       | Models                                                  |
| ---------- | ------------------------------------------------------- |
| `launcher` | "How do you want to join" with Continue on this browser |
| `prejoin`  | name field, microphone and camera switches, Join now    |
| `lobby`    | waiting to be admitted, then moves on after `lobby` ms  |
| `meeting`  | participant tiles, speaking outline, chat, leave        |
| `blocked`  | the tenant does not allow anonymous users               |
| `denied`   | the organizer denied access                             |
| `ended`    | the meeting has ended                                   |
| `left`     | shown after the bot hangs up                            |

The `room-*.html` files are in-call stages that `src/teams-dom.ts` parses in unit tests: one with a speaker, silent, overlapping speakers and a redesign where no selector matches (the parser must return an empty room, which the bot treats as "scrape failed" rather than "everyone left").

`meeting` also has the same self view, chat panel (`chat-button`, `ckeditor`, `newMessageCommands-send`) and `/__event` reporting as the Meet fixture. The chat selectors are best effort, like the rest. `prejoin` passes the microphone and camera switches on to the meeting as the `mic` and `camera` parameters.

Behaviour of the other pages is driven by query parameters on the meeting link: `lobby` (ms in the lobby), `deny`, `blocked`, `endedLobby`, `others` (comma separated names), `speakers`, `joins` and `leaves` (`Name:fromMs-toMs`, comma separated) and `leaveAfter` (ms until everyone else leaves).

## Refreshing

1. Join a meeting as a guest with a few people and capture the stage: DevTools, right click the main stage element, Copy outer HTML.
2. Save one capture with someone speaking, one silent, one with only the bot.
3. Anonymize names, replace the `room-*.html` files, update `teamsRoomSelectors` and bump `TEAMS_SELECTORS_VERSION`.
4. Run `pnpm --filter @openminutes/platforms test`. A broken selector shows up as an empty participant list.

The in-call structure (`data-stream-type="Video"` tiles named by `data-tid`, a `voice-level-stream-outline` that gains `vdi-frame-occlusion` while that person speaks, `#hangup-button`, `aria-label="Chat"`) was recorded from a live Teams meeting on 2026-10-20 and trimmed to the attributes the selectors use.

When the bot is alone Teams shows no tiles, only "Waiting for others to join...", so `scrapeRoom` reports the bot as the only participant when it sees that text.

## Chat fixtures

`chat-messages.html` and `chat-changed-dom.html` feed the chat parser in `src/teams-chat.ts` (selectors in `teamsChatSelectors`, version `TEAMS_CHAT_SELECTORS_VERSION`). They are hand written from knowledge of the Teams meeting chat (`chat-pane-item` rows with `message-author-name`, a `time` element and `chat-pane-message`, where follow-up messages of one author omit the name) and have not been checked against a live meeting. `chat-changed-dom.html` models a redesign and must parse to no messages.

`meeting.html` shows chat in the same markup and accepts the `chat` query parameter (`Name|delayMs|text`, joined with `;`) like the Meet fixture. Without it Alice posts a link two seconds after the join.
