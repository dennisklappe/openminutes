import { describe, expect, it } from 'vitest';
import { demoMinutes } from '../demo.js';
import { ExportError } from '../exporter.js';
import { createGithubExporter, githubFolderName, type GithubContext } from './github.js';

const options = {
  template: 'classic',
  includeTranscript: false,
  timeZone: 'Europe/Amsterdam',
} as const;

function harness(
  context: Partial<GithubContext> = {},
  missingBranch = false,
  contentsExist = false,
) {
  const calls: { method: string; url: string; body: unknown; headers: Headers }[] = [];
  const exporter = createGithubExporter({
    api: 'https://api.test',
    fetch: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const raw = init?.body;
      calls.push({
        method: init?.method ?? 'GET',
        url,
        body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw,
        headers: new Headers(init?.headers),
      });
      const reply = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (url.includes('/contents/')) return reply({}, contentsExist ? 200 : 404);
      if (url.endsWith('/repos/acme/kb')) return reply({ default_branch: 'main' });
      if (url.includes('/git/ref/heads/')) {
        return missingBranch
          ? reply({ message: 'Not Found' }, 404)
          : reply({ object: { sha: 'c0' } });
      }
      if (url.endsWith('/git/commits/c0')) return reply({ tree: { sha: 't0' } });
      if (url.endsWith('/git/trees')) return reply({ sha: 't1' });
      if (url.endsWith('/git/commits')) return reply({ sha: 'c1' });
      return reply({});
    },
    resolve: () =>
      Promise.resolve({
        token: 'ghp_secret',
        repo: 'acme/kb',
        branch: undefined,
        folder: 'meetings',
        includeTranscript: true,
        ...context,
      }),
  });
  return { calls, exporter };
}

describe('github exporter', () => {
  it('commits MINUTES.md and TRANSCRIPT.md to a dated folder in one commit', async () => {
    const { calls, exporter } = harness();
    const outcome = await exporter.export({
      meetingId: 'm1',
      minutes: demoMinutes,
      options,
    });
    expect(outcome).toMatchObject({
      kind: 'link',
      ref: 'meetings/202603121030 Product sync',
      url: 'https://github.com/acme/kb/tree/main/meetings/202603121030%20Product%20sync',
    });
    const tree = calls.find((c) => c.url.endsWith('/git/trees'));
    const entries = (tree?.body as { base_tree: string; tree: { path: string; content: string }[] })
      .tree;
    expect(entries.map((e) => e.path)).toEqual([
      'meetings/202603121030 Product sync/MINUTES.md',
      'meetings/202603121030 Product sync/TRANSCRIPT.md',
    ]);
    expect(entries[0]?.content).toContain('# Product sync');
    expect(entries[0]?.content).not.toContain('Transcript');
    expect(entries[1]?.content).toContain('# Transcript: Product sync');
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH' });
    expect(calls.at(-1)?.url).toBe('https://api.test/repos/acme/kb/git/refs/heads/main');
    expect(calls.every((c) => c.headers.get('authorization') === 'Bearer ghp_secret')).toBe(true);
  });

  it('skips the transcript when switched off', async () => {
    const { calls, exporter } = harness({ includeTranscript: false });
    await exporter.export({ meetingId: 'm1', minutes: demoMinutes, options });
    const tree = calls.find((c) => c.url.endsWith('/git/trees'));
    expect((tree?.body as { tree: unknown[] }).tree).toHaveLength(1);
  });

  it('writes an update into the folder of the first export', async () => {
    const { calls, exporter } = harness({ branch: 'docs' });
    await exporter.export({
      meetingId: 'm1',
      minutes: { ...demoMinutes, title: 'Renamed' },
      options,
      previous: { ref: 'meetings/202603121030 Product sync', url: 'x' },
    });
    const tree = calls.find((c) => c.url.endsWith('/git/trees'));
    expect((tree?.body as { tree: { path: string }[] }).tree[0]?.path).toBe(
      'meetings/202603121030 Product sync/MINUTES.md',
    );
    expect(calls.some((c) => c.url.endsWith('/repos/acme/kb'))).toBe(false);
  });

  it('explains a missing branch and a bad repository name', async () => {
    await expect(
      harness({}, true).exporter.export({ meetingId: 'm1', minutes: demoMinutes, options }),
    ).rejects.toThrow(/Branch "main" was not found/);
    await expect(
      harness({ repo: 'not a repo' }).exporter.export({
        meetingId: 'm1',
        minutes: demoMinutes,
        options,
      }),
    ).rejects.toBeInstanceOf(ExportError);
  });

  it('names the folder in the given zone and keeps path characters out of the title', () => {
    expect(githubFolderName('Q1/Q2: plan?', '2026-03-12T23:30:00.000Z', 'Europe/Amsterdam')).toBe(
      '202603130030 Q1 Q2 plan',
    );
    expect(githubFolderName('', null, undefined)).toBe('Meeting');
  });
});

describe('github exporter retries and updates', () => {
  it('starts over once when the branch moved meanwhile', async () => {
    let patches = 0;
    const exporter = createGithubExporter({
      api: 'https://api.test',
      fetch: (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const reply = (body: unknown, status = 200) =>
          Promise.resolve(new Response(JSON.stringify(body), { status }));
        if (init?.method === 'PATCH') {
          return ++patches === 1
            ? reply({ message: 'Update is not a fast forward' }, 422)
            : reply({});
        }
        if (url.includes('/git/ref/')) return reply({ object: { sha: 'c0' } });
        if (url.endsWith('/git/commits/c0')) return reply({ tree: { sha: 't0' } });
        if (url.endsWith('/git/trees') || url.endsWith('/git/commits')) return reply({ sha: 'x' });
        return reply({});
      },
      resolve: () =>
        Promise.resolve({
          token: 't',
          repo: 'acme/kb',
          branch: 'main',
          folder: '',
          includeTranscript: true,
        }),
    });
    await exporter.export({ meetingId: 'm1', minutes: demoMinutes, options });
    expect(patches).toBe(2);
  });

  it('removes an old transcript on update only when it exists', async () => {
    const run = async (exists: boolean) => {
      const { calls, exporter } = harness(
        { includeTranscript: false, branch: 'main' },
        false,
        exists,
      );
      await exporter.export({
        meetingId: 'm1',
        minutes: demoMinutes,
        options,
        previous: { ref: 'meetings/x', url: 'u' },
      });
      const tree = calls.find((c) => c.url.endsWith('/git/trees'));
      return (tree?.body as { tree: unknown[] }).tree.length;
    };
    expect(await run(true)).toBe(2);
    expect(await run(false)).toBe(1);
  });
});
