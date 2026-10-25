# Meetings in several calendars

One meeting often appears more than once: two Google calendars, Google and Microsoft, a forwarded invite, or organizer and own copies with different event ids. OpenMinutes makes one meeting and one bot join for all of them.

## How copies are matched

Each meeting gets a join key from its link and start time:

- Google Meet: the lowercased meeting code. Query strings (`?authuser=2`), trailing slash and scheme are ignored.
- Teams: the thread id of a `meetup-join` link, or the id of a `/meet/` link. Passcode, `context` and trailing message id are ignored.
- Wrapped links (Outlook Safe Links, Google redirects, Proofpoint, Mimecast-style) are unwrapped first.

Same key and same start time means the same meeting. A different start time is a different meeting, so a recurring meeting on one fixed link stays one meeting per occurrence.

## Join rules with several copies

- Joined when any source calendar's rule allows it. A rejecting calendar is ignored, it never vetoes.
- Cancelled only when no source calendar allows it any more: every copy deleted, declined, ended or rejected, or the calendar disconnected.
- A rescheduled copy briefly becomes its own meeting until the other calendars catch up; the old one is then cancelled.
- Title, location and invitees come from the oldest source calendar, so they do not flip.
- The meeting page shows `From 2 calendars`, names on hover.

## The join-time guard

Before joining, the link is checked again. The bot does not start if another meeting with the same link is joining, in the lobby or recording, or was joined in the last 15 minutes. A skipped queued meeting is marked cancelled with the reason on its page.

Join meeting and `openminutes join <url>` get the same check and answer with a message. Choose Join anyway (`--force` on the command line) to override, for example after the bot was kicked out.
