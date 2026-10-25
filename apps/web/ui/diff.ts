export interface DiffLine {
  kind: 'same' | 'add' | 'del' | 'gap';
  text: string;
}

const CONTEXT = 1;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a.at(-1 - end) === b.at(-1 - end)) {
    end++;
  }
  const x = a.slice(start, a.length - end);
  const y = b.slice(start, b.length - end);
  const table = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  const common = (row: number, column: number) => table[row]?.[column] ?? 0;
  for (let row = x.length - 1; row >= 0; row--) {
    for (let column = y.length - 1; column >= 0; column--) {
      (table[row] ?? [])[column] =
        x[row] === y[column]
          ? common(row + 1, column + 1) + 1
          : Math.max(common(row + 1, column), common(row, column + 1));
    }
  }
  const lines: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    const left = x[i];
    const right = y[j];
    if (left !== undefined && left === right) {
      lines.push({ kind: 'same', text: left });
      i++;
      j++;
    } else if (
      left !== undefined &&
      (right === undefined || common(i + 1, j) >= common(i, j + 1))
    ) {
      lines.push({ kind: 'del', text: left });
      i++;
    } else {
      lines.push({ kind: 'add', text: right ?? '' });
      j++;
    }
  }
  return lines.concat(a.slice(a.length - end).map((text) => ({ kind: 'same', text })));
}

export function changedLines(lines: DiffLine[]): DiffLine[] {
  const near = lines.map((line, index) =>
    lines
      .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
      .some((other) => other.kind === 'add' || other.kind === 'del'),
  );
  const shown: DiffLine[] = [];
  for (const [index, line] of lines.entries()) {
    if (near[index]) shown.push(line);
    else if (shown.at(-1)?.kind !== 'gap') shown.push({ kind: 'gap', text: '' });
  }
  return shown;
}
