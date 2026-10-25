export interface DiffLine {
  kind: 'same' | 'add' | 'del' | 'gap';
  text: string;
}

const CONTEXT = 1;

/** A line diff for the demo: the edit only ever removes a block, so common prefix and suffix are enough. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a.at(-1 - end) === b.at(-1 - end))
    end++;
  return [
    ...a.slice(0, start).map((text): DiffLine => ({ kind: 'same', text })),
    ...a.slice(start, a.length - end).map((text): DiffLine => ({ kind: 'del', text })),
    ...b.slice(start, b.length - end).map((text): DiffLine => ({ kind: 'add', text })),
    ...a.slice(a.length - end).map((text): DiffLine => ({ kind: 'same', text })),
  ];
}

export function changedLines(lines: DiffLine[]): DiffLine[] {
  const changed = (line: DiffLine | undefined) => line?.kind === 'add' || line?.kind === 'del';
  const shown: DiffLine[] = [];
  for (const [index, line] of lines.entries()) {
    const near = [-CONTEXT, 0, CONTEXT].some((offset) => changed(lines[index + offset]));
    if (near) shown.push(line);
    else if (shown.at(-1)?.kind !== 'gap') shown.push({ kind: 'gap', text: '' });
  }
  return shown;
}
