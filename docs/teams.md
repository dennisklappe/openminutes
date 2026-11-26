# Microsoft Teams

OpenMinutes joins Teams meetings in the browser as a guest. Nothing to install; 5 minutes if you administer Teams. It can also join signed in to a Microsoft account, see [Signing the Teams bot in](teams-sign-in.md).

## Links that work

- `https://teams.microsoft.com/l/meetup-join/...`
- `https://teams.microsoft.com/meet/<id>?p=<passcode>`
- `https://teams.live.com/meet/<id>?p=<passcode>`
- `https://teams.live.com/l/meetup-join/...`

Short links in the new web app form (`https://teams.microsoft.com/v2/?meetingjoin=true#/meet/<id>?p=<passcode>`) and links without `https://` work too. `meet.google.com/meet/<code>` equals `meet.google.com/<code>`.

> [!IMPORTANT]
> Paste links as they are. Short links need their `?p=` passcode.

## What the bot does

1. Opens the link, chooses Continue on this browser.
2. Types the bot name, mutes the microphone, keeps the camera off unless you set a camera image, presses Join now.
3. Waits in the lobby, up to the lobby timeout in Settings.
4. Posts the join chat message, records audio, reads participants and the active speaker about four times a second.
5. Leaves when the meeting ends, the bot is alone for the alone timeout, or the maximum length passes.

## When the join fails

The reason shows on the meeting page.

| Status message                                   | Meaning                                          |
| ------------------------------------------------ | ------------------------------------------------ |
| This tenant blocks anonymous guests              | The organiser's tenant disallows guests.         |
| The organizer denied the request to join         | Someone pressed Deny in the lobby or removed it. |
| Nobody admitted the bot before the lobby timeout | Raise the timeout or admit it sooner.            |
| The meeting has already ended                    | The meeting is over.                             |

## Allow guest join (tenant settings)

The organiser's tenant decides, not yours. If you run it, check in the Teams admin center:

1. Meetings, Meeting settings: Anonymous users can join a meeting is On (org-wide, no policy overrides it).
2. Meetings, Meeting policies, your organisers' policy: Anonymous users can join a meeting is On.
3. Optional, same policy: Who can bypass the lobby, so nobody has to admit the bot.
4. Organisers can turn anonymous join off per meeting in Meeting options: check there if one meeting fails.

Changes can take a few hours. For another tenant only its admins can change it; OpenMinutes does not work around it.

## Signed-in Microsoft account

A signed-in account gets past tenants that block anonymous guests and meetings that require a signed-in attendee. In your own tenant, a bot account that is a member joins without the Unverified or External label. It does not lift Teams bot detection (the Suspected threats lobby); only the organiser's admin can change that, see [Bot detection](#bot-detection-suspected-threats).

Once it is set, Teams always joins with that account, as Meet does: the account's name replaces the bot name. Without an account nothing changes, the bot joins as a guest. Setup: [Signing the Teams bot in](teams-sign-in.md).

## Bot detection (Suspected threats)

Since 2026 Teams flags bots that join from outside the organiser's tenant, from "infrastructural and behavioral signals". A headless browser on a server is the typical case. What happens is the organiser tenant's meeting policy setting `ExternalBotAccessMode`:

| Value                                   | Effect                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `RequireApprovalWhenDetected` (default) | The bot waits in the lobby under Suspected threats, even when lobby bypass is on |
| `AllowBots`                             | Detected bots join like any other participant                                    |
| `BlockDetectedBots`                     | Detected bots are refused                                                        |

Signing in does not lift it: Microsoft does not say that a signed-in account changes detection. With the default, the organiser admits the bot from the lobby; "This is not a bot" fixes the label for that meeting. To let it in without that, the organiser tenant's admin sets the policy of the organisers who use OpenMinutes, in Teams PowerShell:

```powershell
Set-CsTeamsMeetingPolicy -Identity <policy> -ExternalBotAccessMode AllowBots
```

Only the organiser's tenant can change it; for other tenants' meetings OpenMinutes cannot.

The Teams Bot Identification Program (registered bot providers show under Waiting instead of Suspected threats) is not obtainable: its public preview is full and Microsoft publishes onboarding only when it is generally available. It would not admit the bot either. See [Manage external bots](https://learn.microsoft.com/en-us/microsoftteams/manage-external-bots) and [Bot identification](https://learn.microsoft.com/en-us/microsoftteams/teams-bot-identification).

<details>
<summary>Other limits</summary>

- Meetings requiring a verified or signed-in attendee are blocked the same way for a guest; a [signed-in account](teams-sign-in.md) gets in.
- A lobby admitting only organisers or the organisation's people needs a manual admit.
- Teams changes its web app without notice. Page reading lives in `packages/platforms/src/teams-selectors.ts`. If joining or speakers break, open an issue with the date.
- Tests use fake Teams pages, not live recordings. Support is young: report what you see.

</details>
