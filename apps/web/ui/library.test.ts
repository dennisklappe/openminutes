import { describe, expect, it } from 'vitest';
import type { FolderDto, LibraryMeetingDto } from '../src/dto.js';
import {
  autoGranularity,
  buildFolderTree,
  folderChoices,
  groupByCompany,
  groupByDate,
  groupByPerson,
  initials,
  personSlot,
  UNKNOWN_COMPANY,
} from './library.js';

let counter = 0;
function minute(heldAt: string, values: Partial<LibraryMeetingDto> = {}): LibraryMeetingDto {
  counter += 1;
  return {
    id: String(counter),
    title: `Minute ${String(counter)}`,
    platform: 'meet',
    heldAt: new Date(heldAt).toISOString(),
    durationMs: 60_000,
    people: [],
    company: null,
    companySource: null,
    folderId: null,
    snippet: '',
    ...values,
  };
}

const spread = (count: number, everyDays: number) =>
  Array.from({ length: count }, (_, i) =>
    minute(new Date(2026, 9, 30 - i * everyDays, 12).toISOString()),
  );

describe('date grouping', () => {
  it('shows few minutes per day', () => {
    expect(autoGranularity(spread(4, 3))).toBe('day');
  });

  it('shows a busy stretch per week and a long thin history per month', () => {
    expect(autoGranularity(spread(14, 1))).toBe('week');
    expect(autoGranularity(spread(12, 20))).toBe('month');
  });

  it('keeps newest first and counts per section', () => {
    const sections = groupByDate(spread(8, 20), 'month');
    expect(sections.map((s) => s.meetings.length).reduce((a, b) => a + b)).toBe(8);
    expect(sections[0]?.meetings[0]?.heldAt).toBe(spread(8, 20)[0]?.heldAt);
    expect(sections.every((s) => s.label.length > 0)).toBe(true);
  });

  it('puts Monday to Sunday in one week and honours a chosen granularity', () => {
    const week = [
      minute(new Date(2026, 9, 26, 9).toISOString()),
      minute(new Date(2026, 9, 25, 9).toISOString()),
      minute(new Date(2026, 9, 19, 9).toISOString()),
    ];
    expect(groupByDate(week, 'week').map((s) => s.meetings.length)).toEqual([1, 2]);
    expect(groupByDate(week, 'day')).toHaveLength(3);
    expect(groupByDate(week, 'month')).toHaveLength(1);
  });
});

describe('company and person grouping', () => {
  it('sorts companies by size and puts unknown last', () => {
    const sections = groupByCompany([
      minute('2026-10-01', { company: 'Acme' }),
      minute('2026-10-02'),
      minute('2026-10-03', { company: 'Globex' }),
      minute('2026-10-04', { company: 'Globex' }),
    ]);
    expect(sections.map((s) => [s.label, s.meetings.length])).toEqual([
      ['Globex', 2],
      ['Acme', 1],
      [UNKNOWN_COMPANY, 1],
    ]);
  });

  it('lists a minute under every person and merges spellings', () => {
    const sections = groupByPerson([
      minute('2026-10-01', { people: ['Anna  de Vries', 'Tom'] }),
      minute('2026-10-02', { people: ['anna de vries'] }),
      minute('2026-10-03', { people: ['Anna de Vries'] }),
    ]);
    expect(sections.map((s) => [s.label, s.meetings.length])).toEqual([
      ['Anna de Vries', 3],
      ['Tom', 1],
    ]);
  });

  it('derives stable initials and colour slots', () => {
    expect(initials('anna de vries')).toBe('AV');
    expect(initials('Tom')).toBe('T');
    expect(personSlot('Tom', 8)).toBe(personSlot(' tom ', 8));
  });
});

describe('folder tree', () => {
  const folders: FolderDto[] = [
    { id: 'b', name: 'Beta', parentId: null },
    { id: 'a', name: 'Alpha', parentId: null },
    { id: 'a1', name: 'Deep', parentId: 'a' },
  ];

  it('nests folders, counts descendants and keeps unfiled apart', () => {
    const { roots, unfiled } = buildFolderTree(folders, [
      minute('2026-10-01', { folderId: 'a1' }),
      minute('2026-10-02', { folderId: 'a' }),
      minute('2026-10-03', { folderId: 'gone' }),
      minute('2026-10-04'),
    ]);
    expect(roots.map((r) => r.folder.name)).toEqual(['Alpha', 'Beta']);
    expect(roots[0]?.total).toBe(2);
    expect(roots[0]?.children[0]?.meetings).toHaveLength(1);
    expect(unfiled).toHaveLength(2);
  });

  it('flattens folders with their depth for pickers', () => {
    expect(folderChoices(folders).map((c) => [c.name, c.depth])).toEqual([
      ['Alpha', 0],
      ['Deep', 1],
      ['Beta', 0],
    ]);
  });
});
