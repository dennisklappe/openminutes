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
  /** Write the transcript as a separate file. */
  includeTranscript: boolean;
  /** Name of the folder per meeting, see GITHUB_VARIABLES. Defaults to GITHUB_DEFAULTS. */
  folderTemplate?: string | undefined;
  minutesFile?: string | undefined;
  transcriptFile?: string | undefined;
}

export interface GithubDeps {
  fetch: Fetch;
  api: string;
  resolve(): Promise<GithubContext>;
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_NAME_LENGTH = 80;

export const GITHUB_DEFAULTS = {
  folderTemplate: '{yyyy}{MM}{dd}{HH}{mm} {title}',
  minutesFile: 'MINUTES.md',
  transcriptFile: 'TRANSCRIPT.md',
} as const;

/** Variables a folder name template may use. */
export const GITHUB_VARIABLES = [
  'yyyy',
  'yy',
  'MM',
  'MMM',
  'MMMM',
  'dd',
  'HH',
  'mm',
  'title',
  'company',
  'id',
] as const;

/** An error message, or undefined when the template only uses known variables. */
export function folderTemplateProblem(template: string): string | undefined {
  const unknown = [...template.matchAll(/\{([^{}]*)\}/g)]
    .map((match) => match[1] ?? '')
    .filter((name) => !(GITHUB_VARIABLES as readonly string[]).includes(name));
  if (unknown.length > 0) return `Unknown variable {${unknown[0]}}`;
  if (/[{}]/.test(template.replace(/\{[^{}]*\}/g, ''))) return 'Unbalanced braces';
  if (!template.includes('{title}') && !template.includes('{id}')) {
    return 'Use {title} or {id} so meetings do not overwrite each other';
  }
  return undefined;
}

/** An error message, or undefined when the name is a plain file name. */
export function fileNameProblem(name: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  if (!name || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || name.startsWith('.')) {
    return 'Use a plain file name without slashes';
  }
  return name.length > 100 ? 'File name is too long' : undefined;
}

const cleanSegment = (text: string) =>
  text
    // eslint-disable-next-line no-control-regex
    .replace(/[\\:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .trim();

function dateValues(startedAt: string | null, timeZone: string | undefined) {
  if (!startedAt || Number.isNaN(new Date(startedAt).getTime())) return undefined;
  try {
    const at = new Date(startedAt);
    const pick = (options: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) =>
      new Intl.DateTimeFormat('en-GB', { ...options, ...(timeZone && { timeZone }) })
        .formatToParts(at)
        .find((part) => part.type === type)?.value ?? '';
    const yyyy = pick({ year: 'numeric' }, 'year');
    return {
      yyyy,
      yy: yyyy.slice(-2),
      MM: pick({ month: '2-digit' }, 'month'),
      MMM: pick({ month: 'short' }, 'month'),
      MMMM: pick({ month: 'long' }, 'month'),
      dd: pick({ day: '2-digit' }, 'day'),
      HH: pick({ hour: '2-digit', hourCycle: 'h23' }, 'hour'),
      mm: pick({ minute: '2-digit' }, 'minute'),
    };
  } catch {
    return undefined;
  }
}

/** The folder one meeting gets, from a template such as `{yyyy}{MM}{dd}{HH}{mm} {title}`. */
export function githubFolderName(
  template: string,
  meeting: {
    title: string;
    startedAt: string | null;
    id: string;
    company?: string | null | undefined;
  },
  timeZone: string | undefined,
): string {
  const date = dateValues(meeting.startedAt, timeZone);
  const values: Record<string, string> = {
    yyyy: date?.yyyy ?? '',
    yy: date?.yy ?? '',
    MM: date?.MM ?? '',
    MMM: date?.MMM ?? '',
    MMMM: date?.MMMM ?? '',
    dd: date?.dd ?? '',
    HH: date?.HH ?? '',
    mm: date?.mm ?? '',
    title: cleanSegment(meeting.title.replace(/\//g, ' ')) || 'Meeting',
    company: cleanSegment((meeting.company ?? '').replace(/\//g, ' ')),
    id: meeting.id.slice(0, 8),
  };
  let name = template.replace(/\{([^{}]*)\}/g, (_, key: string) => values[key] ?? '');
  // Without a start time the date variables are empty, so keep the meetings apart by id.
  if (!date && !template.includes('{id}') && /\{(yyyy|yy|MMMM|MMM|MM|dd|HH|mm)\}/.test(template)) {
    name = `${name} ${values['id']}`;
  }
  const folder = name
    .split('/')
    .map(cleanSegment)
    .filter((segment) => segment && segment !== '..')
    .join('/');
  return folder || values['title'] || 'Meeting';
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
          githubFolderName(
            context.folderTemplate || GITHUB_DEFAULTS.folderTemplate,
            {
              title: minutes.title,
              startedAt: minutes.startedAt,
              id: meetingId,
              company: minutes.company,
            },
            options.timeZone,
          ),
        ]
          .filter(Boolean)
          .join('/');
      const minutesFile = context.minutesFile || GITHUB_DEFAULTS.minutesFile;
      const transcriptFile = context.transcriptFile || GITHUB_DEFAULTS.transcriptFile;

      const files: { path: string; content: string }[] = [
        {
          path: `${folder}/${minutesFile}`,
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
          path: `${folder}/${transcriptFile}`,
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
      if (previous && files.length === 1 && (await exists(`${folder}/${transcriptFile}`))) {
        entries.push({
          path: `${folder}/${transcriptFile}`,
          mode: '100644',
          type: 'blob',
          sha: null,
        });
      }
      const tree = await api.json<{ sha: string }>('POST', `${repoUrl}/git/trees`, {
        base_tree: head.tree.sha,
        tree: entries,
      });
      // Nothing changed since the last commit, so there is nothing to commit.
      if (tree.sha !== head.tree.sha) {
        const commit = await api.json<{ sha: string }>('POST', `${repoUrl}/git/commits`, {
          message: `${previous ? 'Update' : 'Add'} minutes: ${minutes.title}`.slice(0, 200),
          tree: tree.sha,
          parents: [ref.object.sha],
        });
        await api.json('PATCH', `${repoUrl}/git/refs/heads/${encodePath(branch)}`, {
          sha: commit.sha,
        });
      }

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
      'Commits the minutes and the transcript as separate files to a folder in a GitHub repository, one folder per meeting.',
    export: run,
  };
}
