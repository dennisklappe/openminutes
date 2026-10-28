# API endpoint reference

Generated from the route table by `apps/web/src/api-reference.test.ts`. Run `UPDATE_API_REFERENCE=1 pnpm --filter @openminutes/web test -- api-reference` after changing a route. It lists method and path only: request bodies are validated by each route, see the types in `apps/web/src/dto.ts` and the common calls in [API](api.md). The API follows the app and may change between minor versions until 1.0, except the endpoints documented in [API](api.md).

## accounts

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/accounts` | Browser session only |
| `DELETE` | `/api/accounts/:id` | Browser session only |
| `POST` | `/api/accounts/:id/sync` | Browser session only |
| `PUT` | `/api/accounts/calendars/:id` | Browser session only |
| `PUT` | `/api/accounts/providers/:provider` | Browser session only |

## exporters

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/exporters` | Read or full key |

## imports

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/imports/:id` | Read or full key |
| `DELETE` | `/api/imports/:id` | Full key |
| `PUT` | `/api/imports/:id/chunks/:index` | Full key |
| `POST` | `/api/imports/:id/finish` | Full key |
| `POST` | `/api/imports/:id/start` | Full key |
| `GET` | `/api/imports/config` | Read or full key |

## library

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/library` | Read or full key |
| `POST` | `/api/library/companies/rename` | Full key |
| `POST` | `/api/library/folders` | Full key |
| `PATCH` | `/api/library/folders/:id` | Full key |
| `DELETE` | `/api/library/folders/:id` | Full key |
| `PUT` | `/api/library/meetings/:id/company` | Full key |
| `PUT` | `/api/library/meetings/:id/folder` | Full key |

## login

| Method | Path | Access |
| ------ | ---- | ------ |
| `POST` | `/api/login` | Public |

## logout

| Method | Path | Access |
| ------ | ---- | ------ |
| `POST` | `/api/logout` | Public |

## meetings

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/meetings` | Read or full key |
| `POST` | `/api/meetings` | Full key |
| `GET` | `/api/meetings/:id` | Read or full key |
| `DELETE` | `/api/meetings/:id` | Full key |
| `PATCH` | `/api/meetings/:id` | Full key |
| `POST` | `/api/meetings/:id/archive` | Full key |
| `GET` | `/api/meetings/:id/audio` | Read or full key |
| `GET` | `/api/meetings/:id/audio/clip` | Read or full key |
| `POST` | `/api/meetings/:id/calendar-link` | Full key |
| `POST` | `/api/meetings/:id/cancel` | Full key |
| `GET` | `/api/meetings/:id/check-people` | Read or full key |
| `POST` | `/api/meetings/:id/check-people/confirm` | Full key |
| `POST` | `/api/meetings/:id/check-people/dismiss` | Full key |
| `POST` | `/api/meetings/:id/dismissed-invitees` | Full key |
| `POST` | `/api/meetings/:id/export/:exporterId` | Full key |
| `GET` | `/api/meetings/:id/exports` | Read or full key |
| `GET` | `/api/meetings/:id/minutes` | Read or full key |
| `GET` | `/api/meetings/:id/participants` | Read or full key |
| `PUT` | `/api/meetings/:id/participants/:participantId` | Full key |
| `GET` | `/api/meetings/:id/participants/:participantId/identity` | Read or full key |
| `PUT` | `/api/meetings/:id/participants/:participantId/identity` | Full key |
| `PUT` | `/api/meetings/:id/participants/:participantId/invitee` | Full key |
| `PUT` | `/api/meetings/:id/people/:personId/invitee` | Full key |
| `POST` | `/api/meetings/:id/rejoin` | Full key |
| `POST` | `/api/meetings/:id/reprocess` | Full key |
| `POST` | `/api/meetings/:id/rerun-speakers` | Full key |
| `POST` | `/api/meetings/:id/rerun-voices` | Full key |
| `POST` | `/api/meetings/:id/restore` | Full key |
| `GET` | `/api/meetings/:id/room-voices/:voiceId/change` | Read or full key |
| `POST` | `/api/meetings/:id/room-voices/:voiceId/change` | Full key |
| `POST` | `/api/meetings/:id/room-voices/:voiceId/name` | Full key |
| `GET` | `/api/meetings/:id/room/:participantId` | Read or full key |
| `POST` | `/api/meetings/:id/room/:participantId/count` | Full key |
| `POST` | `/api/meetings/:id/room/:participantId/dismiss` | Full key |
| `GET` | `/api/meetings/:id/share-email` | Read or full key |
| `POST` | `/api/meetings/:id/share-email` | Full key |
| `POST` | `/api/meetings/:id/share-email/preview` | Full key |
| `PATCH` | `/api/meetings/:id/shares/:shareId` | Full key |
| `DELETE` | `/api/meetings/:id/shares/:shareId` | Full key |
| `POST` | `/api/meetings/:id/skip` | Full key |
| `POST` | `/api/meetings/:id/skip-series` | Full key |
| `POST` | `/api/meetings/:id/speaker-check` | Full key |
| `POST` | `/api/meetings/:id/speaker-edits` | Full key |
| `POST` | `/api/meetings/:id/speakers-notice/dismiss` | Full key |
| `POST` | `/api/meetings/:id/summaries` | Full key |
| `POST` | `/api/meetings/:id/summaries/:summaryId/restore` | Full key |
| `POST` | `/api/meetings/:id/summaries/edit` | Full key |
| `POST` | `/api/meetings/:id/summary/ai-edit` | Full key |
| `POST` | `/api/meetings/:id/transcribe` | Full key |
| `GET` | `/api/meetings/:id/transcript.json` | Read or full key |
| `GET` | `/api/meetings/:id/transcript.md` | Read or full key |
| `POST` | `/api/meetings/:id/unarchive` | Full key |
| `GET` | `/api/meetings/:id/voices` | Read or full key |
| `PUT` | `/api/meetings/:id/voices/:participantId` | Full key |
| `POST` | `/api/meetings/bulk` | Full key |
| `GET` | `/api/meetings/upcoming` | Read or full key |

## oauth

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/oauth/:provider/callback` | Public |
| `GET` | `/api/oauth/:provider/start` | Browser session only |

## people

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/people` | Read or full key |
| `POST` | `/api/people` | Full key |
| `GET` | `/api/people/:id` | Read or full key |
| `PATCH` | `/api/people/:id` | Full key |
| `DELETE` | `/api/people/:id` | Full key |
| `POST` | `/api/people/:id/lines/:segmentId/mixed` | Full key |
| `POST` | `/api/people/:id/lines/:segmentId/move` | Full key |
| `DELETE` | `/api/people/:id/lines/:segmentId/profile` | Full key |
| `POST` | `/api/people/:id/lines/:segmentId/reject` | Full key |
| `POST` | `/api/people/:id/lines/:segmentId/split` | Full key |
| `POST` | `/api/people/:id/lines/:segmentId/verify` | Full key |
| `POST` | `/api/people/:id/merge` | Full key |
| `POST` | `/api/people/:id/name-voice` | Full key |
| `POST` | `/api/people/:id/tracking` | Full key |
| `DELETE` | `/api/people/:id/voice` | Full key |
| `DELETE` | `/api/people/:id/voice/:language` | Full key |
| `DELETE` | `/api/people/:id/voice/:language/auto` | Full key |
| `DELETE` | `/api/people/auto-voices/:meetingId` | Full key |
| `POST` | `/api/people/backfill` | Full key |
| `GET` | `/api/people/review` | Read or full key |
| `POST` | `/api/people/review/skip` | Full key |
| `POST` | `/api/people/review/undo` | Full key |
| `POST` | `/api/people/review/voices/:id/confirm` | Full key |
| `POST` | `/api/people/review/voices/:id/move` | Full key |
| `POST` | `/api/people/review/voices/:id/reopen` | Full key |
| `POST` | `/api/people/review/voices/:id/skip` | Full key |

## phone

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/phone` | Read or full key |

## recordings

| Method | Path | Access |
| ------ | ---- | ------ |
| `POST` | `/api/recordings` | Full key |
| `GET` | `/api/recordings/:id` | Read or full key |
| `DELETE` | `/api/recordings/:id` | Full key |
| `PUT` | `/api/recordings/:id/chunks/:index` | Full key |
| `POST` | `/api/recordings/:id/finish` | Full key |

## series

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/series/skipped` | Read or full key |
| `POST` | `/api/series/skipped/:id/rejoin` | Full key |

## session

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/session` | Public |

## settings

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/settings/api-keys` | Browser session only |
| `POST` | `/api/settings/api-keys` | Browser session only |
| `DELETE` | `/api/settings/api-keys/:id` | Browser session only |
| `GET` | `/api/settings/bot` | Read or full key |
| `PUT` | `/api/settings/bot` | Full key |
| `PUT` | `/api/settings/bot/camera` | Full key |
| `DELETE` | `/api/settings/bot/camera` | Full key |
| `GET` | `/api/settings/bot/camera` | Read or full key |
| `PUT` | `/api/settings/bot/google-credentials` | Full key |
| `DELETE` | `/api/settings/bot/google-credentials` | Full key |
| `PUT` | `/api/settings/bot/google-notifications` | Full key |
| `GET` | `/api/settings/bot/google-session` | Read or full key |
| `PUT` | `/api/settings/bot/google-session` | Full key |
| `DELETE` | `/api/settings/bot/google-session` | Full key |
| `GET` | `/api/settings/email` | Read or full key |
| `PUT` | `/api/settings/email` | Full key |
| `GET` | `/api/settings/email/provider` | Read or full key |
| `PUT` | `/api/settings/email/provider` | Full key |
| `POST` | `/api/settings/email/provider/test` | Full key |
| `POST` | `/api/settings/email/send-test` | Full key |
| `GET` | `/api/settings/limits` | Read or full key |
| `PUT` | `/api/settings/limits` | Full key |
| `GET` | `/api/settings/minutes` | Read or full key |
| `PUT` | `/api/settings/minutes` | Full key |
| `POST` | `/api/settings/minutes/custom/check` | Full key |
| `GET` | `/api/settings/minutes/export` | Read or full key |
| `PUT` | `/api/settings/minutes/export` | Full key |
| `PUT` | `/api/settings/minutes/logo` | Full key |
| `DELETE` | `/api/settings/minutes/logo` | Full key |
| `GET` | `/api/settings/minutes/logo` | Read or full key |
| `POST` | `/api/settings/minutes/preview` | Full key |
| `GET` | `/api/settings/participant-aliases` | Read or full key |
| `PUT` | `/api/settings/participant-aliases/:id` | Full key |
| `DELETE` | `/api/settings/participant-aliases/:id` | Full key |
| `GET` | `/api/settings/phone` | Read or full key |
| `PUT` | `/api/settings/phone` | Full key |
| `GET` | `/api/settings/prompts` | Read or full key |
| `POST` | `/api/settings/prompts` | Full key |
| `PUT` | `/api/settings/prompts/:id` | Full key |
| `DELETE` | `/api/settings/prompts/:id` | Full key |
| `POST` | `/api/settings/prompts/:id/default` | Full key |
| `GET` | `/api/settings/shared-accounts` | Read or full key |
| `PUT` | `/api/settings/shared-accounts` | Full key |
| `DELETE` | `/api/settings/shared-accounts/:id` | Full key |
| `GET` | `/api/settings/speakers` | Read or full key |
| `PUT` | `/api/settings/speakers` | Full key |
| `GET` | `/api/settings/storage` | Read or full key |
| `PUT` | `/api/settings/storage` | Full key |
| `POST` | `/api/settings/storage/test` | Full key |
| `GET` | `/api/settings/summary` | Read or full key |
| `PUT` | `/api/settings/summary` | Full key |
| `GET` | `/api/settings/summary-chat` | Read or full key |
| `PUT` | `/api/settings/summary-chat` | Full key |
| `POST` | `/api/settings/summary/test` | Full key |
| `GET` | `/api/settings/timezone` | Read or full key |
| `PUT` | `/api/settings/timezone` | Full key |
| `GET` | `/api/settings/transcription` | Read or full key |
| `PUT` | `/api/settings/transcription` | Full key |
| `POST` | `/api/settings/transcription/test` | Full key |
| `GET` | `/api/settings/updates` | Read or full key |
| `PUT` | `/api/settings/updates` | Full key |
| `POST` | `/api/settings/updates/dismiss` | Full key |
| `GET` | `/api/settings/voices` | Read or full key |
| `PUT` | `/api/settings/voices` | Full key |
| `DELETE` | `/api/settings/voices` | Full key |
| `DELETE` | `/api/settings/voices/:id` | Full key |
| `GET` | `/api/settings/wizard` | Read or full key |
| `PUT` | `/api/settings/wizard` | Full key |

## setup

| Method | Path | Access |
| ------ | ---- | ------ |
| `POST` | `/api/setup` | Public |

## version

| Method | Path | Access |
| ------ | ---- | ------ |
| `GET` | `/api/version` | Public |
