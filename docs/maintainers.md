# Maintainers

Notes for people with write access: how CI picks its runner, how releases are cut and how the repository is set up.

## CI runners

The `CI` and `Release` workflows run on the runner named in the repository variable `RUNNER`, and on `ubuntu-latest` when it is not set. `Docker build check` and `Publish images` always use GitHub-hosted `ubuntu-latest` because they need Docker and QEMU.

- `Deploy site` also uses `RUNNER` and only runs in the upstream repository.
- Public repositories use GitHub-hosted runners, which are free for them. Never attach a self-hosted runner to a public repository.

## Releases

1. Merge PRs with Conventional Commit titles. `feat` bumps the minor, `fix` the patch, `!` or `BREAKING CHANGE:` the major (the minor while below 1.0).
2. release-please keeps a release PR open with the changelog and version bumps (`package.json`, `apps/web/package.json`, `.release-please-manifest.json`). It only runs while `PUBLISH_IMAGES` is `true`.
3. Merge the release PR. That tags `vX.Y.Z`, creates the GitHub release and calls `Publish images`.
4. `Publish images` builds `openminutes-web`, `openminutes-worker`, `openminutes-bot` and `openminutes-whisper` for amd64 and arm64, pushes them to GHCR as `X.Y.Z`, `X.Y`, `X` and `latest`, and attaches SBOM and provenance attestations.
5. To republish a tag by hand, run `Publish images` from the Actions tab with the tag.
6. Verify: `docker pull ghcr.io/dennisklappe/openminutes-web:X.Y.Z` and check the version on the Settings page of an upgraded instance.

`RELEASE_PLEASE_TOKEN` is optional. Without it release-please uses `GITHUB_TOKEN`, and the release PR does not trigger CI itself; use a token when you want required checks to run on it.

## Repository setup

How the public repository is configured. A fork or a mirror needs the same settings.

- **History**: the public repository starts from one commit. There is no older history to read, and all development continues from there with pull requests and Conventional Commit titles.
- **Visibility and runners**: GitHub-hosted runners only. Never attach a self-hosted runner to a public repository: a fork PR runs its own code on it, which would give strangers a shell on the host. The `RUNNER` variable is `ubuntu-latest` (or unset, the default is the same).
- **Publishing**: `PUBLISH_IMAGES` is `true`, so release-please and the image build are on. v0.1.0 was the first release.
- **Merging**: squash merge only, delete branches on merge.
- **Features**: Issues and Discussions on (categories Q&A, Ideas, Show and tell), Wiki and Projects off.
- **Security**: private vulnerability reporting, dependency graph, Dependabot alerts and security updates, secret scanning and push protection on. Fork pull request workflows from outside collaborators need approval for all outside collaborators. Workflow permissions stay at read, except that Actions may create pull requests so release-please can open the release PR.
- **Branch protection**: `main` blocks force pushes and deletion. CI (`check`) must be green before merging; that is a convention, not a setting.
- **Secrets and variables**: `CLOUDFLARE_API_TOKEN` (an API token with only the account permission Cloudflare Pages: Edit, nothing else) and `CLOUDFLARE_ACCOUNT_ID` (secrets) and `PUBLIC_TURNSTILE_SITEKEY` (variable) let `Deploy site` publish the website. The workflow only runs in the upstream repository, so forks need none of them.
- **Description and website**: "Self-hosted meeting recorder, transcripts and minutes for Google Meet and Microsoft Teams", `https://openminut.es`. Topics: `meeting-minutes`, `transcription`, `self-hosted`, `google-meet`, `microsoft-teams`, `whisper`, `docker`, `agpl`. The social preview is `brand/og.png` and can only be uploaded in the web UI (Settings, General, Social preview).

## Writing an exporter

Exporters in `packages/minutes` turn a `Minutes` into something: one file implementing `Exporter`, registered once.

```ts
interface Exporter {
  readonly id: string; // unique, in the URL: POST /api/meetings/:id/export/:id
  readonly label: string; // button text
  readonly description: string; // tooltip
  export(input: ExportInput): Promise<ExportOutcome>;
  grantAccess?(input: GrantAccessInput): Promise<GrantAccessOutcome>; // optional, see below
  destination?: boolean; // updatable living copy: shown as a destination row
  shareLabel?: string; // present: offered in Share as
}

interface ExportInput {
  meetingId: string;
  minutes: Minutes; // title, startedAt, endedAt, platform, joinUrl, location,
  //                   attendees, absent, summary (markdown), transcript, chat
  options: RenderOptions; // template, includeTranscript, includeChat (default off), linksTab, logo, timeZone
}

type ExportOutcome =
  | { kind: 'file'; filename: string; contentType: string; body: string | Uint8Array }
  | { kind: 'link'; url: string; label: string } // e.g. a created Google Doc
  | { kind: 'message'; text: string }; // e.g. "Sent to 3 people"
```

To add one:

1. Create `packages/minutes/src/exporters/<name>.ts` exporting an `Exporter`. Use `renderMinutesHtml`, `renderMinutesMarkdown` or read `input.minutes`. `minutesFilename(title, ext)` gives a safe file name.
2. Register it in `createBuiltinExporters()` in `packages/minutes/src/exporters/index.ts`. One needing credentials or a network client comes from a factory registered where the web app is assembled (`exporters` in `createApp`).
3. Add a test. It appears in `GET /api/exporters` with a button, no UI change.

Exporters run server side, act only on their meeting and never log secrets.

### Giving recipients access to a document

Exporters that create documents with their own permissions (Google Doc, OneDrive Word) can implement `grantAccess`. Share with attendees calls it with the recipients' addresses before any mail is sent.

```ts
interface GrantAccessInput {
  meetingId: string;
  url: string; // the link the export returned
  emails: string[];
}
interface GrantAccessOutcome {
  granted: string[];
  failed: { email: string; reason: string }[];
}
```

Exporters without it are skipped (the dialog says permissions were not changed). The share link exporter is a no-op. If some recipients fail, the mail still goes out and the result counts them. Exposed as `ExporterRegistry.grantAccess(id, input)`, `undefined` when unsupported.

## Live test for the Meet bot

Needs a dedicated bot account. `packages/platforms/fixtures/meet/index.html` is a model, `room-live-*.html` are recorded.

1. Create the session file with `node scripts/google-login.mjs` and import it in a test deployment.
2. Create a Meet in another Google account and open it once in a normal browser, so a host can admit people.
3. Paste the link into Join meeting and admit the bot. Expect status recording and the account name in the participant list.
4. Repeat with an organisation that admits members (Join now) and with the session removed (the guest refusal must still be reported).
5. If a step fails, save the prejoin HTML, anonymise it, replace the fixture, update `src/meet-selectors.ts` and bump `MEET_SELECTORS_VERSION`.

## Adding a mail provider

One file in `packages/mail/src/providers/` and one line in `packages/mail/src/registry.ts` (`[smtp, emailit, gmail, acme]`). The settings form is built from the config schema, so the UI needs no change.

```ts
// packages/mail/src/providers/acme.ts
import { request } from '@openminutes/providers';
import { z } from 'zod';
import { formatAddress } from '../address.js';
import { defineMailProvider } from '../define.js';

const configSchema = z.object({
  apiKey: z.string().min(1), // names containing key, token, secret or password are stored encrypted
});

export const acme = defineMailProvider({
  id: 'acme',
  label: 'Acme Mail',
  configSchema,
  create: ({ apiKey }, { fetch }) => ({
    async send(message) {
      await request(
        'https://api.acme.example/send',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: formatAddress(message.from),
            to: message.to,
            subject: message.subject,
            text: message.text,
          }),
        },
        { provider: 'acme', fetch, timeoutMs: 30_000 },
      );
      return {};
    },
    async test() {
      return { detail: 'key saved' };
    },
  }),
});
```

- Add a test in `packages/mail/test/` with a scripted `fetch` (see `helpers.ts`).
- Throw `ProviderError` for expected failures so the message reaches the UI. Never put the key in an error message or log.
