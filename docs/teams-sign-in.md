# Signing the Teams bot in

About 20 minutes, plus a Microsoft 365 work account for the bot. Optional: without it the bot joins Teams as a guest, as before.

## Why

A guest is anonymous. Some tenants block anonymous guests ("This tenant blocks anonymous guests"), some meetings require a signed-in attendee, and Teams labels guests as Unverified. A bot signed in to a work account gets past the first two. In your own tenant a bot account that is a member joins with no label at all; in another tenant it shows as Guest or External.

It does not lift Teams bot detection (the "Suspected threats" lobby). Only the organiser's admin decides that, see [Teams bot detection](teams.md#bot-detection-suspected-threats). Signing in does not guarantee a particular label either.

> [!WARNING]
> Use a dedicated account that exists only for the bot, never a person's account. Automating a user account may conflict with Microsoft's terms and your tenant's policies. That risk is yours.

## The account

- A work or school account with a Teams licence (Microsoft 365 Business Basic is the cheapest). A personal account (outlook.com) is shown as external, so it buys little.
- Its display name is what others see, for example `OpenMinutes Notetaker`.
- MFA and Conditional Access decide whether the server may sign in at all, see [MFA and Conditional Access](#mfa-and-conditional-access).

## Steps

Do this on a computer with a display, not the server. Needs Node.js 22 and Chrome, Edge or Playwright Chromium.

1. Run `pnpm install` here, then `node scripts/microsoft-login.mjs` (`--channel msedge` or `--channel chromium` for another browser).
2. Sign in with the bot account in the window, including MFA, and answer Yes to "Stay signed in?". Without it Microsoft issues only a short session.
3. The script saves `microsoft-session.json` and reopens it in a fresh headless browser. It ends with `Checked` when Teams is still signed in there.
4. Settings, Microsoft Teams sign-in: import the file, then delete it. It is stored encrypted with `OPENMINUTES_SECRET`. Remove session signs the bot out, so it joins as a guest again.
5. Test: paste a Teams link into Join meeting. The bot joins without typing a name and the status reaches recording.

## Sign in with email and password (optional)

With the email and password saved, the bot signs in again by itself when a Teams join finds the session ended. Without them nothing changes: an ended session needs a new session file.

1. Settings, Microsoft Teams sign-in, Sign in with email and password: enter the bot account email and password.
2. If the account has MFA, give it an authenticator app the bot can use. In [My Sign-Ins](https://mysignins.microsoft.com/security-info), Add sign-in method, Authenticator app, "I want to use a different authenticator app", Can't scan image: copy the secret key into Authenticator secret. The bot types the 6-digit code itself.
3. Save. Both are stored encrypted with `OPENMINUTES_SECRET` and never shown again. Remove deletes them.

The bot opens Teams, types the email, the password and the code, and answers Yes to "Stay signed in?". It stores the new session and joins. Steps it cannot pass end the sign-in with "Microsoft asked for a step the bot cannot pass", naming the step:

| Step                                                        | What to do                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Number matching in Microsoft Authenticator                  | Add an authenticator app with a secret (step 2) and make it the default sign-in method |
| A code by text message, phone call or email                 | Same: the bot only types authenticator app codes                                       |
| A security key or passkey                                   | Not possible for a bot. Use a session file                                             |
| Setting up more security info ("More information required") | Sign in once in a normal browser and finish the setup                                  |
| A captcha                                                   | Sign in once in a normal browser, then import a session file                           |

Other reasons: "Conditional Access blocked the sign-in", "Microsoft rejected the password", "The tenant sends the sign-in to ... (federated sign-in)" (ADFS, Okta and other identity providers are not supported, use a session file).

> [!WARNING]
> Password plus authenticator secret on the server turn MFA into "whoever has the database and `OPENMINUTES_SECRET`". Use the dedicated bot account only, with no admin roles and access to nothing but Teams.

## MFA and Conditional Access

Your tenant admin decides these, OpenMinutes never works around them.

- Security defaults (on in new tenants) make every account register MFA within 14 days and ask for it on risky sign-ins. A password alone then stops working: save the authenticator secret, or use only a session file.
- Per-user MFA or a Conditional Access policy that requires MFA: same, the authenticator secret is needed. Number matching and passwordless sign-in cannot be automated.
- Conditional Access can block the server outright: a compliant or hybrid-joined device required, an approved client app, a location rule (the server's datacenter address), or sign-in risk (Entra ID P2 can flag a sign-in from a server as risky). The sign-in then fails with "Conditional Access blocked the sign-in". Fix: exclude the bot account from the device and risk policies, or add the server address as a named location.
- Sign-in frequency policies end the session after a set time no matter what. With the password saved the bot signs in again; without it, import a new session file.
- "Stay signed in?" turned off by the tenant: Microsoft only issues a short session. The password sign-in still works, it just runs more often.

## Session status

| State                | Meaning                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Microsoft account | The bot joins Teams as a guest                                                                                                                                                                          |
| Signed in            | The sign-in cookies have not run out (checked offline)                                                                                                                                                  |
| Signed out           | Cookies ran out or a join found the bot signed out. With a saved password the next join signs in again, else Teams meetings fail with "The Microsoft session of the bot expired" until you import again |

The offline check is weaker than for Google: a tenant can end sessions early (sign-in frequency, password change, revoked sessions). The join is the real test.

## When signed in

- The bot opens the Teams link with the session and picks Continue on this browser. The pre-join screen has no name field: Teams uses the account name, so the Bot identity display name applies to guests only.
- It mutes the microphone, and the camera unless you set a camera image, then waits in the lobby when the meeting has one.
- After a successful join it stores the refreshed session, so regular use keeps it alive.

## Keep-alive and alerts

- Once a day (04:53 server time) the bot opens Teams headless with the session. Still signed in, it stores the refreshed session; the result shows under the session status in Settings.
- Sent to the sign-in page with a saved password, it signs in again and records "Signed in again with the saved password". When that hits a step it cannot pass, the result shows Needs attention with the reason.
- Without a saved password, or when the sign-in failed, it marks the session Signed out and mails the owner address: "The OpenMinutes bot needs to sign in to Microsoft again". Import a new session file, or remove the session so the bot joins as a guest.
- It also mails when the persistent sign-in cookie ends within 72 hours, and when a join finds the bot signed out.
- At most one mail a day, counted apart from the Google alerts. Needs a mail provider and an owner address (Settings, Email). Turn it off with "Email me when the session fails or is about to run out".
- Signed in, the bot recognises its own tile by the account name stored in the session, so it is not listed as a participant in the minutes.

## When it fails

- "The Microsoft session of the bot expired": Teams sent the bot to the Microsoft sign-in page, or showed the guest name field. With a saved password the bot signs in once and retries; the message then ends with why that failed. Otherwise run the script again and import the new file. The bot does not retry as a guest.
- "Microsoft asked for a step the bot cannot pass": see the table in [Sign in with email and password](#sign-in-with-email-and-password-optional).
- "This tenant blocks anonymous guests" while signed in: the organiser's tenant does not admit this account either. Only its admins can change that.
- The import says the file has no Microsoft sign-in cookies: the file is not from `scripts/microsoft-login.mjs`, or the sign-in did not finish.
