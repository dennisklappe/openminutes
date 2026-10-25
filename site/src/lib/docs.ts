import { getCollection, type CollectionEntry } from 'astro:content';
import nav from '../../../docs/_nav.json';

export interface DocPage {
  entry: CollectionEntry<'docs'>;
  slug: string;
  title: string;
  lead: string;
}

export interface DocGroup {
  name: string;
  pages: DocPage[];
  collapsed?: boolean;
}

export interface DocTree {
  groups: DocGroup[];
  more: DocPage[];
}

const OVERVIEW_FILE = 'README';

export const docPath = (file: string): string =>
  file === OVERVIEW_FILE ? '/docs' : `/docs/${file}`;

const TITLE = /^# (.+)$/m;
const GUIDE = /^- \[[^\]]+\]\(([\w-]+)\.md\):\s*(.+)$/gm;

/** The guide list in docs/README.md doubles as the one line description of every page. */
function descriptions(overview: string): Map<string, string> {
  return new Map(
    [...overview.matchAll(GUIDE)].flatMap((m) => (m[1] && m[2] ? [[m[1], m[2]] as const] : [])),
  );
}

/** docs/_nav.json curates the sidebar. Every other guide is listed under More. */
export async function docTree(): Promise<DocTree> {
  const entries = await getCollection('docs');
  const byFile = new Map(entries.map((e) => [e.id === 'readme' ? OVERVIEW_FILE : e.id, e]));
  const curated = new Set<string>(nav.hidden);

  const groups = nav.groups.map((group) => ({
    name: group.name,
    pages: group.pages.flatMap((p) => {
      const entry = byFile.get(p.file);
      curated.add(p.file);
      return entry ? [{ entry, slug: p.file, title: p.title, lead: p.lead }] : [];
    }),
  }));

  const described = descriptions(byFile.get(OVERVIEW_FILE)?.body ?? '');
  const more = [...byFile]
    .filter(([file]) => !curated.has(file))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, entry]) => ({
      entry,
      slug: file,
      title: TITLE.exec(entry.body ?? '')?.[1] ?? file,
      lead: described.get(file) ?? '',
    }));

  return { groups, more };
}

export function sidebar(tree: DocTree): DocGroup[] {
  return tree.more.length > 0
    ? [...tree.groups, { name: 'More', pages: tree.more, collapsed: true }]
    : tree.groups;
}

export function flatten(tree: DocTree): DocPage[] {
  return [...tree.groups.flatMap((g) => g.pages), ...tree.more];
}
