# Signing the Teams bot in

About 20 minutes, plus a Microsoft 365 work account for the bot. Optional: without it the bot joins Teams as a guest, as before.

## Why

A guest is anonymous. Some tenants block anonymous guests ("This tenant blocks anonymous guests"), some meetings require a signed-in attendee, and Teams labels guests as Unverified. A bot signed in to a work account gets past the first two. In your own tenant a bot account that is a member joins with no label at all; in another tenant it shows as Guest or External.

It does not lift Teams bot detection (the "Suspected threats" lobby). Only the organiser's admin decides that, see [Teams](teams.md#signed-in-microsoft-account). Signing in does not guarantee a particular label either.

> [!WARNING]
> Use a dedicated account that exists only for the bot, never a person's account. Automating a user account may conflict with Microsoft's terms and your tenant's policies. That risk is yours.

## The account

- A work or school account with a Teams licence (Microsoft 365 Business Basic is the cheapest). A personal account (outlook.com) is shown as external, so it buys little.
- Its display name is what others see, for example `OpenMinutes Notetaker`.
- Conditional Access can block a sign-in from a server (compliant device required, location, sign-in risk). That is your tenant admin's decision: exclude the bot account from device policies or add the server address as a named location.
- Security defaults force MFA. That is fine here: you sign in once in a normal browser, the server only reuses the session.

## Steps

Do this on a computer with a display, not the server. Needs Node.js 22 and Chrome, Edge or Playwright Chromium.

1. Run `pnpm install` here, then `node scripts/microsoft-login.mjs` (`--channel msedge` or `--channel chromium` for another browser).
2. Sign in with the bot account in the window, including MFA, and answer Yes to "Stay signed in?". Without it Microsoft issues only a short session.
3. The script saves `microsoft-session.json` and reopens it in a fresh headless browser. It ends with `Checked` when Teams is still signed in there.
4. Settings, Microsoft Teams sign-in: import the file, then delete it. It is stored encrypted with `OPENMINUTES_SECRET`. Remove session signs the bot out, so it joins as a guest again.
5. Test: paste a Teams link into Join meeting. The bot joins without typing a name and the status reaches recording.

## Session status

| State                | Meaning                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| No Microsoft account | The bot joins Teams as a guest                                                                                                                 |
| Signed in            | The sign-in cookies have not run out (checked offline)                                                                                         |
| Signed out           | Cookies ran out or a join found the bot signed out. Teams meetings fail with "The Microsoft session of the bot expired" until you import again |

The offline check is weaker than for Google: a tenant can end sessions early (sign-in frequency, password change, revoked sessions). The join is the real test.

## When signed in

- The bot opens the Teams link with the session and picks Continue on this browser. The pre-join screen has no name field: Teams uses the account name, so the Bot identity display name applies to guests only.
- It mutes the microphone, and the camera unless you set a camera image, then waits in the lobby when the meeting has one.
- After a successful join it stores the refreshed session, so regular use keeps it alive.

## Keep-alive and alerts

- Once a day (04:53 server time) the bot opens Teams headless with the session. Still signed in, it stores the refreshed session; the result shows under the session status in Settings.
- Sent to the sign-in page, it marks the session Signed out and mails the owner address: "The OpenMinutes bot needs to sign in to Microsoft again". Import a new session file, or remove the session so the bot joins as a guest.
- It also mails when the persistent sign-in cookie ends within 72 hours, and when a join finds the bot signed out.
- At most one mail a day, counted apart from the Google alerts. Needs a mail provider and an owner address (Settings, Email). Turn it off with "Email me when the session fails or is about to run out".
- Signed in, the bot recognises its own tile by the account name stored in the session, so it is not listed as a participant in the minutes.

## When it fails

- "The Microsoft session of the bot expired": Teams sent the bot to the Microsoft sign-in page, or showed the guest name field. Run the script again and import the new file. The bot does not retry as a guest.
- "This tenant blocks anonymous guests" while signed in: the organiser's tenant does not admit this account either. Only its admins can change that.
- The import says the file has no Microsoft sign-in cookies: the file is not from `scripts/microsoft-login.mjs`, or the sign-in did not finish.

Not built yet: signing in again with a saved password. Follow [issue #50](https://github.com/dennisklappe/openminutes/issues/50).
