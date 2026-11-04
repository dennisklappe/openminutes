import { ExportError, type Exporter, type ExportInput, type ExportOutcome } from '../exporter.js';
import { renderMinutesMarkdown, renderTranscriptMarkdown } from '../render-markdown.js';
import { apiClient, type Fetch } from './http.js';

export interface GithubContext {
  token: string;
  /** `owner/name`. */
  repo: string;
  /** The default branch of the repository when empty. */
  branch: string | undefined;
  /** A folder inside the repository, empty for the root. */
  folder: string;
  /** Write the transcript as a separate TRANSCRIPT.md. */
  includeTranscript: boolean;
}

export interface GithubDeps {
  fetch: Fetch;
  api: string;
  resolve(): Promise<GithubContext>;
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_NAME_LENGTH = 80;

/** `YYYYMMDDHHMM Title`, the name of the folder one meeting gets. */
export function githubFolderName(
  title: string,
  startedAt: string | null,
  timeZone: string | undefined,
): string {
  const clean = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  const name = clean || 'Meeting';
  if (!startedAt || Number.isNaN(new Date(startedAt).getTime())) return name;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(timeZone && { timeZone }),
    }).formatToParts(new Date(startedAt));
  } catch {
    return name;
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const stamp = `${part('year')}${part('month')}${part('day')}${part('hour')}${part('minute')}`;
  return `${stamp} ${name}`;
}

const cleanFolder = (folder: string) =>
  folder
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export function createGithubExporter(deps: GithubDeps): Exporter {
  async function run({
    meetingId,
    minutes,
    options,
    previous,
  }: ExportInput): Promise<ExportOutcome> {
    const context = await deps.resolve();
    if (!REPO_PATTERN.test(context.repo)) {
      throw new ExportError('The GitHub repository must look like owner/name');
    }
    const api = apiClient('GitHub', deps.fetch, context.token);
    const repoUrl = `${deps.api}/repos/${context.repo}`;

    const branch =
      context.branch || (await api.json<{ default_branch: string }>('GET', repoUrl)).default_branch;
    const exists = (path: string) =>
      api
        .json('GET', `${repoUrl}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`)
        .then(
          () => true,
          () => false,
        );

    // Someone else may push between reading the branch and moving it, then we start over.
    for (let attempt = 1; ; attempt++) {
      try {
        return await commit();
      } catch (error) {
        if (
          attempt >= 3 ||
          !(error instanceof ExportError) ||
          !/fast.forward/i.test(error.message)
        ) {
          throw error;
        }
      }
    }

    async function commit(): Promise<ExportOutcome> {
      const ref = await api
        .json<{ object: { sha: string } }>('GET', `${repoUrl}/git/ref/heads/${encodePath(branch)}`)
        .catch((error: unknown) => {
          if (error instanceof ExportError && /Not Found|Empty|HTTP 404/i.test(error.message)) {
            throw new ExportError(
              `Branch "${branch}" was not found in ${context.repo}. Check the name, and that the repository has a first commit.`,
            );
          }
          throw error;
        });
      const head = await api.json<{ tree: { sha: string } }>(
        'GET',
        `${repoUrl}/git/commits/${ref.object.sha}`,
      );

      // An update keeps writing to the folder the first export made, even if the title changed.
      const root = cleanFolder(context.folder);
      const folder =
        previous?.ref ??
        [
          root,
          `${githubFolderName(minutes.title, minutes.startedAt, options.timeZone)}${
            minutes.startedAt ? '' : ` ${meetingId.slice(0, 8)}`
          }`,
        ]
          .filter(Boolean)
          .join('/');

      const files: { path: string; content: string }[] = [
        {
          path: `${folder}/MINUTES.md`,
          content: renderMinutesMarkdown(minutes, {
            ...options,
            includeTranscript: false,
            includeChat: false,
            linksTab: false,
          }),
        },
      ];
      if (context.includeTranscript && minutes.transcript.length > 0) {
        files.push({
          path: `${folder}/TRANSCRIPT.md`,
          content: renderTranscriptMarkdown(minutes, options),
        });
      }

      const entries: Record<string, unknown>[] = files.map((file) => ({
        path: file.path,
        mode: '100644',
        type: 'blob',
        content: file.content,
      }));
      // An update without a transcript removes the one an earlier export left behind.
      if (previous && files.length === 1 && (await exists(`${folder}/TRANSCRIPT.md`))) {
        entries.push({ path: `${folder}/TRANSCRIPT.md`, mode: '100644', type: 'blob', sha: null });
      }
      const tree = await api.json<{ sha: string }>('POST', `${repoUrl}/git/trees`, {
        base_tree: head.tree.sha,
        tree: entries,
      });
      const commit = await api.json<{ sha: string }>('POST', `${repoUrl}/git/commits`, {
        message: `${previous ? 'Update' : 'Add'} minutes: ${minutes.title}`.slice(0, 200),
        tree: tree.sha,
        parents: [ref.object.sha],
      });
      await api.json('PATCH', `${repoUrl}/git/refs/heads/${encodePath(branch)}`, {
        sha: commit.sha,
      });

      return {
        kind: 'link',
        url: `https://github.com/${context.repo}/tree/${encodePath(branch)}/${encodePath(folder)}`,
        label: previous ? 'Open the updated folder on GitHub' : 'Open the folder on GitHub',
        ref: folder,
      };
    }
  }

  return {
    id: 'github',
    label: 'GitHub repository',
    destination: true,
    description:
      'Commits MINUTES.md and TRANSCRIPT.md to a folder in a GitHub repository, one folder per meeting.',
    export: run,
  };
}
