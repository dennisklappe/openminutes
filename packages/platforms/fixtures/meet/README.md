# Meet fixtures

`index.html` is the fake meeting page used by the end-to-end run. It stands in for meet.google.com and supports query parameters: `lobby`, `deny`, `blocked`, `signedInOnly`, `direct`, `others`, `speakers`, `joins`, `leaves` and `leaveAfter`.

The fixture models the signed-in prejoin page too. It reads the `SID` cookie on the page: with `SID=fixture-session` (a cookie on `.google.com`, as in a Playwright storage state) there is no name input, the page shows the account name `Bot Account` and joins under it, and `direct` replaces the lobby with a `Join now` button for a host in the same organisation. `signedInOnly` makes the page refuse everybody without that cookie, like the real refusal of signed-out guests. The signed-in page was checked against a live call on 2026-10-22: a signed-in visitor sees no name field, the account name and either Join now or Ask to join, and the lobby shows Leave call already.

In the meeting the fixture also has a self view that shows the camera stream (`getUserMedia`), a chat panel (`Chat with everyone`, a `Send a message` textarea and button) and reports what it saw to `/__event` on the fixture server (`joined` with the name and camera state, `camera-frame` with the mean colour and a small PNG, `chat`). `GET /__events` returns them. The chat selectors are in `src/meet-selectors.ts` and are best effort until checked against a live call.

The `room-*.html` files are the in-call grids that `src/meet-dom.ts` parses in unit tests.

## Recorded fixtures

`room-live-speaking.html` and `room-live-silent.html` were recorded from a real Meet call on 2026-10-22 (the bot signed in, one tile per participant, someone speaking and the same room a moment later). Names are replaced and images, inline styles and event wiring are stripped, the class names, `jsname` values and structure are as Meet served them. The other `room-*.html` files are built from one recorded tile and only vary the names and the speaking state. `index.html` now mimics the signed-in lobby of the live page (Leave call visible, "Please wait until a meeting host brings you into the call").

## Provenance of the rest

The prejoin, lobby and chat parts of `index.html` are hand written from what the live page showed (see `docs/meet-sign-in.md`), not copied from it. The participant tiles use Meet's name and speaking markup: the name is the first non-empty `span.notranslate` of a tile with `data-participant-id`, and a tile is silent when its `[jsname="QgSmzd"]` indicator has the class `gjg47c`. These are obfuscated names that Meet can change, so re-record when the room tests start failing in a live call.

## Refreshing

1. Join a call as the bot (or any guest) with a few participants and capture the grid: DevTools, right click the main grid element, Copy outer HTML.
2. Save one capture with someone speaking and one silent. To find the speaking marker, play a track with known silences into the call and compare tiles over time.
3. Anonymize names, replace the files here, update `meetSelectors` and bump `MEET_DOM_VERSION`.
4. Run `pnpm --filter @openminutes/platforms test`. A broken selector shows up as an empty participant list.

`room-changed-dom.html` models a redesign where none of the selectors match: the parser must return an empty list, which the bot treats as "scrape failed" rather than "everyone left".

## Microphone probe

In the meeting the fixture opens the microphone with `getUserMedia({ audio: true })`, honours the mute button (`data-mic` on the body) and records the loudest sample it heard in `data-mic-peak`. `micOnAfterJoin` turns the mic on when the call starts, like Meet does for some signed-in guests, and `micLocked` makes the button ignore presses. The Teams `meeting` fixture has the same parameters and an in-call `toggle-mute` button.

## Chat fixtures

`chat-live.html` was recorded from a real call on 2026-10-22 (two sessions of one account chatting, as the second session sees the panel, names replaced, images, styles and event wiring stripped). It showed that a message group has the sender in `.poVWob` (not `.YTbUzc`), that the groups of the viewer have the class `ydIQ1d` and no sender, and that the pin button repeats the `data-message-id` of its message. `room-live-same-name.html` comes from the same call and holds the two tiles of one account, which share a name and differ in `data-participant-id`.

`chat-messages.html` and `chat-changed-dom.html` feed the chat parser in `src/meet-chat.ts` (selectors in `meetChatSelectors`, version `MEET_CHAT_SELECTORS_VERSION`). They are hand written from knowledge of the Meet chat panel (the real panel differs, see `chat-live.html`, and the parser accepts both): message groups (`.Ss4fHf`) with a sender and time header and one `[data-message-id]` element per message. `chat-changed-dom.html` models a redesign and must parse to no messages.

`index.html` also shows chat in this markup. Query parameter `chat` seeds messages from other people as `Name|delayMs|text`, joined with `;`. Without it Alice posts an agenda link two seconds after the join. The chat button gets `aria-pressed`, which the bot uses to open the panel only when it is closed. Messages the bot sends appear as `You` and carry `data-own` for tests.
