import { describe, expect, it } from 'vitest';
import { changedLines, diffLines } from './diff.js';

const kinds = (before: string, after: string) =>
  diffLines(before, after).map((line) => `${line.kind}:${line.text}`);

describe('diffLines', () => {
  it('marks removed and added lines and keeps the rest', () => {
    expect(kinds('a\nb\nc', 'a\nc\nd')).toEqual(['same:a', 'del:b', 'same:c', 'add:d']);
  });

  it('shows a rewritten line as one removal and one addition', () => {
    expect(kinds('a\nold\nc', 'a\nnew\nc')).toEqual(['same:a', 'del:old', 'add:new', 'same:c']);
  });

  it('reports no change for equal text', () => {
    expect(diffLines('a\nb', 'a\nb').every((line) => line.kind === 'same')).toBe(true);
  });
});

describe('changedLines', () => {
  it('keeps one line of context and folds long unchanged runs', () => {
    const lines = diffLines('1\n2\n3\n4\n5\n6\n7\n8', '1\n2\n3\n4\n5\n6\n7\nx');
    expect(changedLines(lines).map((line) => `${line.kind}:${line.text}`)).toEqual([
      'gap:',
      'same:7',
      'del:8',
      'add:x',
    ]);
  });
});
