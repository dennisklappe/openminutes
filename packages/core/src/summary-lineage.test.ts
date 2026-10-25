import { describe, expect, it } from 'vitest';
import { editLineage, parseReplay } from './summary-lineage.js';

type Row = Parameters<typeof editLineage>[0][number];
const row = (
  id: string,
  origin: Row['origin'],
  note: string | null = null,
  restoredFrom: string | null = null,
): Row => ({
  id,
  origin,
  note,
  restoredFrom,
});

describe('editLineage', () => {
  it('collects the AI instructions since the last generated summary, oldest first', () => {
    const rows = [
      row('0', 'ai', null),
      row('1', 'ai-edit', 'old'),
      row('2', 'ai'),
      row('3', 'ai-edit', 'a'),
      row('4', 'ai-edit', 'b'),
    ];
    expect(editLineage(rows)).toEqual({ instructions: ['a', 'b'], manualEdits: false });
  });

  it('flags manual edits but still collects the instructions before them', () => {
    const rows = [row('1', 'ai'), row('2', 'ai-edit', 'a'), row('3', 'edit'), row('4', 'rename')];
    expect(editLineage(rows)).toEqual({ instructions: ['a'], manualEdits: true });
  });

  it('leaves out an undone instruction by following the restore', () => {
    const rows = [
      row('1', 'ai'),
      row('2', 'ai-edit', 'a'),
      row('3', 'ai-edit', 'b'),
      row('4', 'restore', null, '2'),
    ];
    expect(editLineage(rows)).toEqual({ instructions: ['a'], manualEdits: false });
  });

  it('has nothing to replay for a plain generated summary', () => {
    expect(editLineage([row('1', 'ai')])).toEqual({ instructions: [], manualEdits: false });
  });
});

describe('parseReplay', () => {
  it('reads a stored list and ignores anything else', () => {
    expect(parseReplay('["a","b"]')).toEqual(['a', 'b']);
    expect(parseReplay('{"a":1}')).toEqual([]);
    expect(parseReplay('nope')).toEqual([]);
    expect(parseReplay(null)).toEqual([]);
  });
});
