# Bot identity

Settings, Bot identity. Everything is free to set.

| Setting           | Details                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display name      | Typed when joining as a guest (a Meet [Google account](meet-sign-in.md) shows its own name instead). Up to 64 characters, one line. Default `OpenMinutes Notetaker`; empty restores it. |
| Join chat message | Posted in the chat on admission, on Meet and Teams. Up to 500 characters, one line. `{{name}}` becomes the display name. Switch off to send nothing.                                    |
| Camera image      | Optional PNG or JPEG, up to 2 MB, 16:9 best (other shapes get black bars). Without it the camera stays off.                                                                             |

Default join message:

> OpenMinutes notetaker is recording notes for this meeting. For more info see https://openminut.es/

Existing installs keep a customised message; a saved copy of an earlier default moves to this one. One cleared before the switch existed stays off. If sending fails, the bot logs it and keeps recording.

> [!NOTE]
> Meet chat selectors were checked on a real call on 2026-10-22. Teams chat selectors are best effort until checked live.

Chromium plays the image as a fake video device, looped by ffmpeg. Verified on test fixtures only, not live. If conversion fails, the bot joins with the camera off.

## The bot never makes sound

The browser starts with a silent audio file instead of Chromium's beeping fake microphone. The microphone is muted before joining and checked in the call (the bot presses mute again up to five times). A guard switches off any outgoing track that is not silent. `apps/bot/src/silent-mic.test.ts` fails if the launch arguments let a tone through.
