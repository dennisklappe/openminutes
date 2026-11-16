# Whereby fixtures

| File                      | What it is                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `index.html`              | Stand-in for the room page (name prompt, no devices, knock or join, lobby, room, chat, left, ended) |
| `room-live-speaking.html` | Real capture of a guest's view of a room with two people (2026-11-16, names anonymized)             |
| `room-live-chat.html`     | Real capture of the host's view with the chat panel open and one message                            |

`index.html` is driven by query parameters on the room link: `nameStep`, `noDevices`, `locked=0` (join button instead of knock), `lobby` (ms), `deny`, `others`, `speakers` (`Name:fromMs-toMs`), `leaveAfter` (ms until the host ends the meeting) and `chat` (`Name|delayMs|text`, joined with `;`).

The selectors in `src/whereby-selectors.ts` use Whereby's `jstest-*` classes and `data-testid`s, recorded from a free account room on 2026-11-16. Not captured yet: the join button of an unlocked room, the host roomKey flow, `subdomain.whereby.com` rooms, the host ending the meeting, the "on hold" state, and the audio indicator when everybody is silent (the speaking rule is an opacity threshold on `_AudioIndicator_`, tune it when a silent capture exists).

To refresh: join a room as a guest, save `document.documentElement.outerHTML`, strip scripts, anonymize names, run `pnpm --filter @openminutes/platforms test`.
