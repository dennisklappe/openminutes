import type { FolderDto, LibraryMeetingDto } from '../src/dto.js';

export type Granularity = 'day' | 'week' | 'month';
export type GroupBy = 'auto' | Granularity;

export interface Section {
  key: string;
  label: string;
  meetings: LibraryMeetingDto[];
}

export const UNKNOWN_COMPANY = 'Unknown company';
const FEW_MEETINGS = 6;
const MIN_PER_SECTION = 3;

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) =>
  `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function mondayOf(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

const bucketKey: Record<Granularity, (d: Date) => string> = {
  day: dayKey,
  week: (d) => dayKey(mondayOf(d)),
  month: (d) => `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}`,
};

const bucketLabel: Record<Granularity, (d: Date) => string> = {
  day: (d) =>
    d.toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  week: (d) =>
    `Week of ${mondayOf(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`,
  month: (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
};

/** Few minutes read best per day, then per week while a week still holds a few, otherwise per month. */
export function autoGranularity(meetings: readonly LibraryMeetingDto[]): Granularity {
  if (meetings.length <= FEW_MEETINGS) return 'day';
  const weeks = new Set(meetings.map((m) => bucketKey.week(new Date(m.heldAt))));
  return meetings.length / weeks.size >= MIN_PER_SECTION ? 'week' : 'month';
}

/** Newest first, as the meetings arrive. */
export function groupByDate(meetings: readonly LibraryMeetingDto[], by: GroupBy): Section[] {
  const granularity = by === 'auto' ? autoGranularity(meetings) : by;
  const sections = new Map<string, Section>();
  for (const meeting of meetings) {
    const date = new Date(meeting.heldAt);
    const key = bucketKey[granularity](date);
    const section = sections.get(key) ?? {
      key,
      label: bucketLabel[granularity](date),
      meetings: [],
    };
    section.meetings.push(meeting);
    sections.set(key, section);
  }
  return [...sections.values()];
}

const byCountThenName = (a: Section, b: Section) =>
  b.meetings.length - a.meetings.length || a.label.localeCompare(b.label);

export function groupByCompany(meetings: readonly LibraryMeetingDto[]): Section[] {
  const sections = new Map<string, Section>();
  const unknown: Section = { key: '', label: UNKNOWN_COMPANY, meetings: [] };
  for (const meeting of meetings) {
    if (!meeting.company) {
      unknown.meetings.push(meeting);
      continue;
    }
    const section = sections.get(meeting.company) ?? {
      key: meeting.company,
      label: meeting.company,
      meetings: [],
    };
    section.meetings.push(meeting);
    sections.set(meeting.company, section);
  }
  const known = [...sections.values()].sort(byCountThenName);
  return unknown.meetings.length > 0 ? [...known, unknown] : known;
}

const personKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

/** A minute appears under every person. Spellings that differ only in case or spacing are one person. */
export function groupByPerson(meetings: readonly LibraryMeetingDto[]): Section[] {
  const people = new Map<string, Section & { spellings: Map<string, number> }>();
  for (const meeting of meetings) {
    for (const name of new Set(meeting.people.map((p) => p.replace(/\s+/g, ' ').trim()))) {
      const key = personKey(name);
      const section = people.get(key) ?? {
        key,
        label: name,
        meetings: [] as LibraryMeetingDto[],
        spellings: new Map<string, number>(),
      };
      section.meetings.push(meeting);
      section.spellings.set(name, (section.spellings.get(name) ?? 0) + 1);
      people.set(key, section);
    }
  }
  return [...people.values()]
    .map(({ spellings, ...section }) => ({
      ...section,
      label: [...spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '',
    }))
    .sort(byCountThenName);
}

export interface FolderNode {
  folder: FolderDto;
  meetings: LibraryMeetingDto[];
  children: FolderNode[];
  total: number;
}

export function buildFolderTree(
  folders: readonly FolderDto[],
  meetings: readonly LibraryMeetingDto[],
): { roots: FolderNode[]; unfiled: LibraryMeetingDto[] } {
  const nodes = new Map<string, FolderNode>(
    folders.map((folder) => [folder.id, { folder, meetings: [], children: [], total: 0 }]),
  );
  const unfiled: LibraryMeetingDto[] = [];
  for (const meeting of meetings) {
    const node = meeting.folderId ? nodes.get(meeting.folderId) : undefined;
    if (node) node.meetings.push(meeting);
    else unfiled.push(meeting);
  }
  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.folder.parentId ? nodes.get(node.folder.parentId) : undefined;
    (parent?.children ?? roots).push(node);
  }
  const count = (node: FolderNode): number => {
    node.children.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
    node.total = node.meetings.length + node.children.reduce((sum, child) => sum + count(child), 0);
    return node.total;
  };
  roots.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
  roots.forEach(count);
  return { roots, unfiled };
}

export interface FolderChoice {
  id: string;
  name: string;
  depth: number;
}

export function folderChoices(folders: readonly FolderDto[]): FolderChoice[] {
  const { roots } = buildFolderTree(folders, []);
  const flat: FolderChoice[] = [];
  const walk = (node: FolderNode, depth: number) => {
    flat.push({ id: node.folder.id, name: node.folder.name, depth });
    node.children.forEach((child) => {
      walk(child, depth + 1);
    });
  };
  roots.forEach((root) => {
    walk(root, 0);
  });
  return flat;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function personSlot(name: string, slots: number): number {
  let hash = 0;
  for (const char of personKey(name)) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash % slots;
}
